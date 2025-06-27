import os
import logging
import re
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import jwt
from functools import wraps
from dotenv import load_dotenv
import markdown

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[AI_SVC] %(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Configuration
PORT = int(os.getenv('AI_SERVICE_PORT', 3004))
JWT_SECRET = os.getenv('JWT_SECRET', 'your-secret-key')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
EMAIL_SERVICE_URL = f"http://localhost:{os.getenv('EMAIL_SERVICE_PORT', 3003)}"

# Intelligent Markdown Cleaner and HTML Converter
class IntelligentMarkdownProcessor:
    
    @staticmethod
    def clean_markdown_response(raw_markdown):
        """
        Comprehensively clean and format markdown response from AI
        """
        if not raw_markdown or not raw_markdown.strip():
            return "No summary available"
        
        processor = IntelligentMarkdownProcessor()
        
        # Step 1: Normalize and pre-process
        content = processor._deep_normalize(raw_markdown.strip())
        
        # Step 2: Fix all structural and formatting issues BEFORE markdown conversion
        content = processor._comprehensive_fix(content)
        
        # Step 3: Final validation and cleanup
        content = processor._final_cleanup(content)
        
        return content
    
    def _deep_normalize(self, content):
        """Deep normalization of content"""
        # Normalize line endings and whitespace
        content = content.replace('\r\n', '\n').replace('\r', '\n')
        
        # Split into lines for processing
        lines = content.split('\n')
        normalized_lines = []
        
        for line in lines:
            # Remove excessive whitespace but preserve intentional indentation
            if line.strip():
                # Keep leading whitespace for indented content, clean trailing
                leading_space = len(line) - len(line.lstrip())
                cleaned_content = line.strip()
                normalized_lines.append(' ' * min(leading_space, 4) + cleaned_content)
            else:
                normalized_lines.append('')
        
        return '\n'.join(normalized_lines)
    
    def _comprehensive_fix(self, content):
        """Fix all issues comprehensively before markdown conversion"""
        lines = content.split('\n')
        fixed_lines = []
        current_section_type = None
        
        for i, line in enumerate(lines):
            original_line = line
            stripped = line.strip()
            
            if not stripped:
                fixed_lines.append(line)
                continue
            
            # Determine what type of content this is
            content_type = self._identify_content_type(stripped)
            
            # Fix based on content type
            if content_type == 'title':
                fixed_line = self._fix_title(stripped)
                current_section_type = 'title'
                
            elif content_type == 'section_heading':
                fixed_line = self._fix_section_heading(stripped)
                current_section_type = 'section'
                
            elif content_type == 'subsection_heading':
                fixed_line = self._fix_subsection_heading(stripped)
                current_section_type = 'subsection'
                
            elif content_type == 'checkbox':
                fixed_line = self._fix_checkbox_comprehensive(stripped)
                
            elif content_type == 'list_item':
                fixed_line = self._fix_list_item_comprehensive(stripped)
                
            elif content_type == 'responsibility':
                fixed_line = self._fix_responsibility(stripped)
                
            elif content_type == 'deadline':
                fixed_line = self._fix_deadline(stripped)
                
            elif content_type == 'regular_text':
                fixed_line = self._fix_regular_text(stripped, current_section_type)
                
            else:
                fixed_line = self._fix_text_formatting(stripped)
            
            fixed_lines.append(fixed_line)
        
        return '\n'.join(fixed_lines)
    
    def _identify_content_type(self, line):
        """Identify what type of content this line represents"""
        if 'Email Analysis Summary' in line:
            return 'title'
        elif re.match(r'^#{0,6}\s*\d+\.\s+', line):
            return 'section_heading'
        elif re.match(r'^#{0,6}\s*[A-Za-z][^:]*$', line) and len(line.split()) <= 5:
            return 'subsection_heading'
        elif re.match(r'^[-*+]?\s*\[\s*[x\s]*\]\s*', line, re.IGNORECASE):
            return 'checkbox'
        elif re.match(r'^[-*+]\s+', line):
            return 'list_item'
        elif re.match(r'^\*\*[^*]+\*\*:\s*$', line):
            return 'responsibility'
        elif re.match(r'^\*\*[^*]+\*\*:\s*.+', line):
            return 'deadline'
        elif re.match(r'^(Generated|Version|Source):', line):
            return 'metadata'
        else:
            return 'regular_text'
    
    def _fix_title(self, line):
        """Fix title formatting"""
        return '# Email Analysis Summary'
    
    def _fix_section_heading(self, line):
        """Fix section heading formatting"""
        # Extract section number and title
        match = re.match(r'^#{0,6}\s*(\d+)\.\s*(.+)', line)
        if match:
            num, title = match.groups()
            return f'## {num}. {title.strip()}'
        return f'## {line.strip()}'
    
    def _fix_subsection_heading(self, line):
        """Fix subsection heading formatting"""
        clean_title = re.sub(r'^#{0,6}\s*', '', line).strip()
        return f'### {clean_title}'
    
    def _fix_checkbox_comprehensive(self, line):
        """Comprehensively fix checkbox formatting"""
        # Remove any existing list markers and checkbox brackets
        content = re.sub(r'^[-*+]?\s*\[\s*[x\s]*\]\s*', '', line, flags=re.IGNORECASE)
        
        # Determine if it should be checked
        is_checked = bool(re.search(r'\[x\]', line, re.IGNORECASE))
        
        # Return proper checkbox format
        checkbox_marker = '- [x]' if is_checked else '- [ ]'
        return f'{checkbox_marker} {content.strip()}'
    
    def _fix_list_item_comprehensive(self, line):
        """Comprehensively fix list item formatting"""
        # Extract content after any list marker
        content = re.sub(r'^[-*+]\s*', '', line).strip()
        
        # Handle malformed items like "-Word" -> "- Word"
        content = re.sub(r'^([A-Z])', r'\1', content)
        
        return f'- {content}'
    
    def _fix_responsibility(self, line):
        """Fix responsibility formatting"""
        match = re.match(r'^\*\*([^*]+)\*\*:\s*$', line)
        if match:
            return f'**{match.group(1).strip()}:**'
        return line
    
    def _fix_deadline(self, line):
        """Fix deadline formatting"""
        match = re.match(r'^\*\*([^*]+)\*\*:\s*(.+)', line)
        if match:
            date_part, desc_part = match.groups()
            return f'**{date_part.strip()}:** {desc_part.strip()}'
        return line
    
    def _fix_regular_text(self, line, section_type):
        """Fix regular text with context awareness"""
        # Apply text formatting fixes
        fixed = self._fix_text_formatting(line)
        
        # Context-aware fixes - convert plain text to lists in certain sections
        if section_type in ['subsection'] and len(fixed) > 15 and not fixed.startswith(('**', '-', '*', '+')):
            # This might be content that should be a list item
            if not re.match(r'^(Generated|Version|Source):', fixed):
                return f'- {fixed}'
        
        return fixed
    
    def _fix_text_formatting(self, line):
        """Fix text formatting issues comprehensively"""
        # Fix bold text first
        line = re.sub(r'\*\*\s*([^*]+?)\s*\*\*', r'**\1**', line)
        
        # Fix spacing around bold text - handle all cases
        # Case 1: word**bold**word -> word **bold** word
        line = re.sub(r'(\w)\*\*([^*]+?)\*\*(\w)', r'\1 **\2** \3', line)
        
        # Case 2: **bold**word -> **bold** word  
        line = re.sub(r'\*\*([^*]+?)\*\*([a-zA-Z])', r'**\1** \2', line)
        
        # Case 3: word**bold** -> word **bold**
        line = re.sub(r'([a-zA-Z])\*\*([^*]+?)\*\*', r'\1 **\2**', line)
        
        # Fix spacing with punctuation - CRITICAL FIX
        # **bold** 's -> **bold**'s (remove space before apostrophe)
        line = re.sub(r'\*\*([^*]+?)\*\*\s+([\'\.,;:!?])', r'**\1**\2', line)
        
        # Fix word concatenation
        line = re.sub(r'([a-z])([A-Z][a-z])', r'\1 \2', line)
        
        # Fix specific concatenation patterns
        line = re.sub(r'(\w)(and|or|on|in|at|to|for|with|by)([A-Z])', r'\1 \2 \3', line)
        
        # Fix emoji spacing
        line = re.sub(r'([💰💸📊💵⏰])\s*([^\s\n])', r'\1 \2', line)
        
        return line
    
    def _final_cleanup(self, content):
        """Final cleanup and optimization"""
        lines = content.split('\n')
        cleaned_lines = []
        prev_was_empty = False
        
        for line in lines:
            is_empty = not line.strip()
            
            # Prevent more than one consecutive empty line
            if is_empty and prev_was_empty:
                continue
                
            cleaned_lines.append(line)
            prev_was_empty = is_empty
        
        # Remove leading and trailing empty lines
        while cleaned_lines and not cleaned_lines[0].strip():
            cleaned_lines.pop(0)
        while cleaned_lines and not cleaned_lines[-1].strip():
            cleaned_lines.pop()
        
        return '\n'.join(cleaned_lines)
    
    @staticmethod
    def convert_to_html(cleaned_markdown):
        """Convert cleaned markdown to HTML with post-processing fixes"""
        
        if not cleaned_markdown or not cleaned_markdown.strip():
            return "<p>No summary available</p>"
        
        # Convert markdown to HTML
        md = markdown.Markdown(extensions=[
            'markdown.extensions.extra',
            'markdown.extensions.codehilite'
        ])
        
        html_content = md.convert(cleaned_markdown)
        
        # Apply comprehensive post-processing
        processor = IntelligentMarkdownProcessor()
        html_content = processor._post_process_html(html_content)
        
        return html_content
    
    def _post_process_html(self, html_content):
        """Comprehensive HTML post-processing"""
        
        # First, fix any issues the markdown converter created
        html_content = self._fix_markdown_converter_issues(html_content)
        
        # Then apply styling and enhancements
        html_content = self._apply_comprehensive_styling(html_content)
        
        return html_content
    
    def _fix_markdown_converter_issues(self, html_content):
        """Fix issues created by the markdown converter"""
        
        # Fix checkboxes that got converted incorrectly - handle ALL variations
        # Pattern 1: <li>- [ ] content</li> -> proper checkbox
        html_content = re.sub(
            r'<li>-\s*\[\s*\]\s*([^<]+)</li>',
            r'<li class="checkbox-item"><input type="checkbox" disabled> <span>\1</span></li>',
            html_content
        )
        
        # Pattern 2: <li>- [x] content</li> -> checked checkbox
        html_content = re.sub(
            r'<li>-\s*\[x\]\s*([^<]+)</li>',
            r'<li class="checkbox-item"><input type="checkbox" checked disabled> <span>\1</span></li>',
            html_content,
            flags=re.IGNORECASE
        )
        
        # Pattern 3: <li>[ ] content</li> -> proper checkbox (without dash)
        html_content = re.sub(
            r'<li>\[\s*\]\s*([^<]+)</li>',
            r'<li class="checkbox-item"><input type="checkbox" disabled> <span>\1</span></li>',
            html_content
        )
        
        # Pattern 4: <li>[x] content</li> -> checked checkbox (without dash)
        html_content = re.sub(
            r'<li>\[x\]\s*([^<]+)</li>',
            r'<li class="checkbox-item"><input type="checkbox" checked disabled> <span>\1</span></li>',
            html_content,
            flags=re.IGNORECASE
        )
        
        # Fix checkbox patterns in paragraphs
        html_content = re.sub(
            r'<p>-?\s*\[\s*\]\s*([^<]+)</p>',
            r'<div class="checkbox-item"><input type="checkbox" disabled> <span>\1</span></div>',
            html_content
        )
        
        html_content = re.sub(
            r'<p>-?\s*\[x\]\s*([^<]+)</p>',
            r'<div class="checkbox-item"><input type="checkbox" checked disabled> <span>\1</span></div>',
            html_content,
            flags=re.IGNORECASE
        )
        
        # Fix plain text checkboxes that appear as text
        html_content = re.sub(
            r'(\[\s*\])\s*([^<\n]+)',
            r'<input type="checkbox" disabled style="margin-right: 0.5em;"> <span>\2</span>',
            html_content
        )
        
        html_content = re.sub(
            r'(\[x\])\s*([^<\n]+)',
            r'<input type="checkbox" checked disabled style="margin-right: 0.5em;"> <span>\2</span>',
            html_content,
            flags=re.IGNORECASE
        )
        
        return html_content
    
    def _apply_comprehensive_styling(self, html_content):
        """Apply comprehensive styling to HTML"""
        
        # Define all styles upfront
        styles = {
            'container': 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 100%; padding: 1.5em; background: #fff;',
            'h1': 'font-size: 2.2em; font-weight: bold; margin: 0 0 1.5em 0; color: #1a365d; border-bottom: 3px solid #3182ce; padding-bottom: 0.5em;',
            'h2': 'font-size: 1.6em; font-weight: bold; margin: 2.5em 0 1em 0; color: #2d3748; border-bottom: 2px solid #4299e1; padding-bottom: 0.3em;',
            'h3': 'font-size: 1.3em; font-weight: 600; margin: 1.8em 0 0.8em 0; color: #4a5568;',
            'ul': 'margin: 1em 0; padding-left: 1.5em; list-style-type: disc;',
            'li': 'margin: 0.4em 0; line-height: 1.5;',
            'checkbox_li': 'list-style: none; margin: 0.6em 0; position: relative; padding-left: 0; display: flex; align-items: flex-start;',
            'checkbox_input': 'margin-right: 0.5em; margin-top: 0.1em; transform: scale(1.1); flex-shrink: 0;',
            'responsibility': 'font-weight: 600; margin: 1.5em 0 0.8em 0; color: #2d3748; font-size: 1.1em; background: #f7fafc; padding: 0.5em; border-radius: 4px; border-left: 3px solid #4299e1;',
            'deadline': 'margin: 0.8em 0; padding: 0.8em; background: linear-gradient(135deg, #fff5f5, #ffe8e8); border-left: 4px solid #e53e3e; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);',
            'deadline_date': 'font-weight: bold; color: #c53030; font-size: 1.05em;',
            'financial': 'margin: 0.5em 0; padding: 0.6em; background: #f7fafc; border-radius: 6px; border-left: 3px solid #38b2ac;',
            'emoji': 'margin-right: 0.6em; font-size: 1.2em;'
        }
        
        # Apply heading styles with clear hierarchy
        html_content = re.sub(r'<h1>', f'<h1 style="{styles["h1"]}">', html_content)
        html_content = re.sub(r'<h2>', f'<h2 style="{styles["h2"]}">', html_content)
        html_content = re.sub(r'<h3>', f'<h3 style="{styles["h3"]}">', html_content)
        
        # Apply list styles
        html_content = re.sub(r'<ul>', f'<ul style="{styles["ul"]}">', html_content)
        
        # Style regular list items
        html_content = re.sub(r'<li>(?!<)', f'<li style="{styles["li"]}">', html_content)
        
        # Style checkbox items specifically
        html_content = re.sub(
            r'<li class="checkbox-item">',
            f'<li class="checkbox-item" style="{styles["checkbox_li"]}">',
            html_content
        )
        
        # Style checkbox inputs
        html_content = re.sub(
            r'<input type="checkbox"([^>]*)>',
            f'<input type="checkbox"\\1 style="{styles["checkbox_input"]}">',
            html_content
        )
        
        # Handle financial items with emojis
        for emoji in ['💰', '💸', '📊', '💵', '⏰']:
            html_content = re.sub(
                f'<li[^>]*>\\s*{re.escape(emoji)}\\s*([^<]+)</li>',
                f'<li style="{styles["financial"]}"><span style="{styles["emoji"]}">{emoji}</span><span>\\1</span></li>',
                html_content
            )
        
        # Handle responsibility sections
        html_content = re.sub(
            r'<p><strong>([^<]+?):</strong></p>',
            f'<div style="{styles["responsibility"]}">\\1:</div>',
            html_content
        )
        
        # Handle responsibility sections that might be in different formats
        html_content = re.sub(
            r'<p><strong>([^<]+?)</strong>:\s*</p>',
            f'<div style="{styles["responsibility"]}">\\1:</div>',
            html_content
        )
        
        # Handle inline responsibility format
        html_content = re.sub(
            r'<p><strong>([^<]+?):</strong>\s*([^<]+?)</p>',
            f'<div style="{styles["responsibility"]}">\\1:</div><p style="margin: 0.5em 0;">\\2</p>',
            html_content
        )
        
        # Handle deadline formatting - make sure it doesn't conflict with responsibility
        html_content = re.sub(
            r'<p><strong>([^<]*?(?:PM|AM|UTC)[^<]*?):</strong>\s*([^<]+?)</p>',
            f'<div style="{styles["deadline"]}"><span style="{styles["deadline_date"]}">\\1:</span> <span>\\2</span></div>',
            html_content
        )
        
        # Wrap in styled container
        html_content = f'<div style="{styles["container"]}">{html_content}</div>'
        
        return html_content

# JWT Authentication decorator
def authenticate_jwt(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            logger.warning("No Authorization header provided")
            return jsonify({'message': 'No token provided'}), 401
        
        try:
            # Remove 'Bearer ' prefix if present
            if token.startswith('Bearer '):
                token = token[7:]
            
            # Decode the JWT token
            decoded_token = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            request.user = decoded_token
            logger.info(f"Authenticated user: {decoded_token.get('id', 'unknown')}")
            
        except jwt.ExpiredSignatureError:
            logger.warning("Token has expired")
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            logger.warning("Invalid token provided")
            return jsonify({'message': 'Invalid token'}), 401
        
        return f(*args, **kwargs)
    return decorated_function

@app.before_request
def log_request():
    logger.info(f"{request.method} {request.path} - Headers: {dict(request.headers)}")

@app.after_request
def log_response(response):
    logger.info(f"Response {response.status_code} for {request.method} {request.path}")
    return response

@app.route('/health', methods=['GET'])
@authenticate_jwt
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'ai-services',
        'timestamp': datetime.utcnow().isoformat(),
        'gemini_model': 'gemini-2.5-flash',
        'gemini_configured': GEMINI_API_KEY is not None
    }), 200

@app.route('/api/emails/<email_id>/summarize', methods=['POST'])
@authenticate_jwt
def summarize_email(email_id):
    """Generate AI-powered summary of email content"""
    user_id = request.user.get('id')
    logger.info(f"Received request to summarize email ID: {email_id} for user: {user_id}")
    
    if not GEMINI_API_KEY:
        logger.error("Gemini API is not configured")
        return jsonify({'message': 'AI service is not properly configured'}), 500
    
    try:
        # Fetch email content from email service
        logger.info(f"Fetching email content for ID: {email_id}")
        headers = {'Authorization': request.headers.get('Authorization')}
        
        response = requests.get(
            f"{EMAIL_SERVICE_URL}/api/emails/{email_id}",
            headers=headers,
            timeout=30
        )
        
        if not response.ok:
            logger.error(f"Failed to fetch email content: {response.status_code} - {response.text}")
            return jsonify({'message': 'Failed to fetch email content'}), response.status_code
        
        email_data = response.json()
        body = email_data.get('body', '')
        
        if not body:
            logger.error(f"No body content found for email ID: {email_id}")
            return jsonify({'message': 'Could not find text content in this email to summarize'}), 400
        
        # Clean HTML tags and prepare for AI summarization
        import re
        clean_body = re.sub(r'<[^>]*>', '', body)
        
        # Advanced business analyst prompt (exactly as in JavaScript)
        prompt_text = """You are a meticulous business analyst AI. Your task is to analyze the email content I provide and generate a structured summary based on a strict Markdown template. You must follow all instructions and formatting rules precisely.

                Core Instructions:

                Analyze: Carefully read the email provided at the end of this prompt.
                Extract: Identify the key message, all action items, responsible parties, deadlines, and financial details.
                Populate: Fill in the provided Markdown Analysis Summary template using only the information from the email.
                Omit Empty Sections: If an entire numbered section (e.g., ## 3. Financial Impact) has no relevant information in the email, omit the entire section from your output.
                Handle Missing Subsections: If a specific subsection (e.g., ### Budget) has no relevant information, write N/A for its details.
                Generate Metadata: For the ## 10. Metadata section, use the current date and time for [DateTime]. Set the [Version] to 1.0 and the [Source] to "User-provided email".
                Formatting Rules (Strictly Enforce):

                Line Breaks: Add exactly TWO blank lines after each major section heading (##).
                Line Breaks: Add exactly TWO blank lines after each subsection heading (###).
                Lists: Use a single hyphen (-) for all list items. Add ONE blank line between items in a list.
                Checkboxes: Use - [ ] for all items under ### Required Actions and ### Next Steps.
                Emphasis: Use bold (**...**) for emphasis on people, roles, dates, and key terms.
                Emojis: You MUST use the specified emojis at the start of each point in the ## 3. Financial Impact section.
                Indentation: Do not indent any lists.

                Of course. The issue with your original prompt is that it mixes instructions, format specifications, and an example output all together. This can confuse the AI, leading it to produce inconsistent or flawed results.

                A more effective prompt will clearly separate the role, the task, the input, the formatting rules, and the output template. This makes your request unambiguous and guides the AI to the precise output you need.

                Here is a refined, high-quality prompt designed for Gemini.

                Refined Prompt for Gemini
                Prompt Start:

                You are a meticulous business analyst AI. Your task is to analyze the email content I provide and generate a structured summary based on a strict Markdown template. You must follow all instructions and formatting rules precisely.

                Core Instructions:

                Analyze: Carefully read the email provided at the end of this prompt.
                Extract: Identify the key message, all action items, responsible parties, deadlines, and financial details.
                Populate: Fill in the provided Markdown Analysis Summary template using only the information from the email.
                Omit Empty Sections: If an entire numbered section (e.g., ## 3. Financial Impact) has no relevant information in the email, omit the entire section from your output.
                Handle Missing Subsections: If a specific subsection (e.g., ### Budget) has no relevant information, write N/A for its details.
                Generate Metadata: For the ## 10. Metadata section, use the current date and time for [DateTime]. Set the [Version] to 1.0 and the [Source] to "User-provided email".
                Formatting Rules (Strictly Enforce):

                Line Breaks: Add exactly TWO blank lines after each major section heading (##).
                Line Breaks: Add exactly TWO blank lines after each subsection heading (###).
                Lists: Use a single hyphen (-) for all list items. Add ONE blank line between items in a list.
                Checkboxes: Use - [ ] for all items under ### Required Actions and ### Next Steps.
                Emphasis: Use bold (**...**) for emphasis on people, roles, dates, and key terms.
                Emojis: You MUST use the specified emojis at the start of each point in the ## 3. Financial Impact section.
                Indentation: Do not indent any lists.

                Markdown Analysis Summary Template:

                # Email Analysis Summary

                ## 1. Executive Summary

                ### Key Message

                - [Key message in 1-2 sentences]


                ### Action Items/Decisions

                - [High-level action item or decision 1]

                - [High-level action item or decision 2]


                ## 2. Action Items

                ### Required Actions

                - [ ] [Action 1]

                - [ ] [Action 2]


                ### Next Steps

                - [ ] [Step 1]

                - [ ] [Step 2]


                ### Responsibilities

                **[Person/Role]**: 
                - [Responsibility 1]

                - [Responsibility 2]


                ### Deadlines

                **[Date]**: [Description of what is due on this date]


                ## 3. Financial Impact

                ### Revenue

                💰 [Details regarding revenue impact, or N/A]


                ### Costs

                💸 [Details regarding cost impact, or N/A]


                ### Budget

                📊 [Details regarding budget impact, or N/A]


                ### Financial Values

                💵 [List specific financial values mentioned, or N/A]


                ### Deadlines

                ⏰ [List any finance-related deadlines, or N/A]


                ## 10. Metadata

                Generated: [DateTime]

                Version: [Version]

                Source: [Source]"""
        
        # Create the full prompt
        prompt = f"{prompt_text} from the following email content:\n\n---\n{clean_body}"
        
        # Create chat history format for Gemini API
        chat_history = [{"role": "user", "parts": [{"text": prompt}]}]
        gemini_payload = {"contents": chat_history}
        
        logger.info(f"Sending email content to Gemini 2.5 Flash API for summarization")
        
        # Call Gemini 2.5 Flash API
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
        
        gemini_response = requests.post(
            api_url,
            headers={'Content-Type': 'application/json'},
            json=gemini_payload,
            timeout=60
        )
        
        if not gemini_response.ok:
            error_text = gemini_response.text
            logger.error(f"Gemini API request failed: {error_text}")
            return jsonify({'message': 'Failed to generate email summary. Please check your Gemini API configuration.'}), 500
        
        result = gemini_response.json()
        
        if result.get('candidates') and len(result['candidates']) > 0:
            raw_summary = result['candidates'][0]['content']['parts'][0]['text']
            logger.info(f"Raw summary received from Gemini for email: {email_id}")
            
            # Clean the markdown response intelligently
            cleaned_markdown = IntelligentMarkdownProcessor.clean_markdown_response(raw_summary)
            logger.info(f"Markdown cleaned for email: {email_id}")
            
            # Convert to HTML for frontend display
            html_summary = IntelligentMarkdownProcessor.convert_to_html(cleaned_markdown)
            logger.info(f"Successfully generated and processed summary for email: {email_id}")
            
            return jsonify({
                'summary': html_summary,
                'summary_markdown': cleaned_markdown,
                'summary_raw': raw_summary
            }), 200
        else:
            logger.error("Unexpected response format from Gemini API")
            return jsonify({'message': 'Unexpected response format from Gemini API'}), 500
        
    except requests.RequestException as e:
        logger.error(f"Error fetching email content: {str(e)}")
        return jsonify({'message': 'Failed to fetch email content'}), 500
    except Exception as e:
        logger.error(f"Error summarizing email {email_id} for user {user_id}: {str(e)}")
        return jsonify({'message': 'Failed to generate email summary'}), 500

@app.route('/api/ai/generate-content', methods=['POST'])
@authenticate_jwt
def generate_content():
    """General AI content generation endpoint"""
    try:
        data = request.get_json()
        prompt = data.get('prompt')
        
        if not prompt:
            return jsonify({'message': 'Prompt is required'}), 400
        
        if not GEMINI_API_KEY:
            return jsonify({'message': 'AI service is not properly configured'}), 500
        
        logger.info("Generating AI content")
        response = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}",
            headers={'Content-Type': 'application/json'},
            json={"contents": [{"role": "user", "parts": [{"text": prompt}]}]},
            timeout=60
        )
        
        if not response.ok:
            error_text = response.text
            logger.error(f"Gemini API request failed: {error_text}")
            return jsonify({'message': 'Failed to generate content'}), 500
        
        result = response.json()
        
        if result.get('candidates') and len(result['candidates']) > 0:
            content = result['candidates'][0]['content']['parts'][0]['text']
            logger.info(f"Successfully generated content for prompt: {prompt}")
            return jsonify({'content': content}), 200
        else:
            logger.error("Unexpected response format from Gemini API")
            return jsonify({'message': 'Unexpected response format from Gemini API'}), 500
        
    except requests.RequestException as e:
        logger.error(f"Error generating content: {str(e)}")
        return jsonify({'message': 'Failed to generate content'}), 500
    except Exception as e:
        logger.error(f"Error generating content: {str(e)}")
        return jsonify({'message': 'Failed to generate content'}), 500

@app.errorhandler(404)
def not_found(error):
    logger.warning(f"404 - Route not found: {request.method} {request.path}")
    return jsonify({'message': 'Route not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"500 - Internal server error: {str(error)}")
    return jsonify({'message': 'Internal server error'}), 500

if __name__ == '__main__':
    logger.info(f"✅ AI Services running on http://localhost:{PORT}")
    logger.info(f"🤖 Gemini 2.5 Flash API configured: {GEMINI_API_KEY is not None}")
    logger.info(f"📧 Email Service URL: {EMAIL_SERVICE_URL}")
    app.run(host='0.0.0.0', port=PORT, debug=False) 