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
import base64
from PIL import Image
import io
import json
import re
import ast # Used for safely evaluating string representations of dictionaries

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


# ==============================================================================
#                      RECOMMENDED CODE REPLACEMENT
# ==============================================================================

import json

# STEP 1: Define your schema as a native Python dictionary. This is much safer.
SCHEMA_DEFINITION = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
        "classification": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": [
                        "Official/Work",
                        "Primary Conversation",
                        "Transactional",
                        "Promotions & Marketing",
                        "Subscriptions & Newsletters",
                        "Security Alert",
                        "Financial / Bills",
                        "Social & Notifications",
                        "Other"
                    ]
                },
                "confidenceScore": {
                    "type": "number",
                    "description": "A score from 0.0 to 1.0 indicating the AI's confidence in the classification."
                },
                "keywordsFound": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "A list of up to 3 keywords from the email that led to this classification."
                }
            }
        },
        "executiveSummary": {
            "type": "object",
            "properties": {
                "keyMessage": {"type": "string"},
                "mainActionItems": {"type": "array", "items": {"type": "string"}},
                "decisions": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["keyMessage"]
        },
        "actionItems": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "responsible": {"type": "string"},
                            "deadline": {"type": "string", "format": "date"},
                            "status": {"type": "string"}
                        },
                        "required": ["description"]
                    }
                },
                "nextSteps": {"type": "array", "items": {"type": "string"}},
                "requiredActions": {"type": "array", "items": {"type": "string"}}
            }
        },
        "financialImpact": {
            "type": "object",
            "properties": {
                "revenueImplications": {"type": "array", "items": {"type": "object", "properties": {"description": {"type": "string"}, "value": {"type": ["number", "string", "null"]}, "timeline": {"type": "string"}}}},
                "costImplications": {"type": "array", "items": {"type": "object", "properties": {"description": {"type": "string"}, "value": {"type": ["number", "string", "null"]}, "timeline": {"type": "string"}}}},
                "budgetConsiderations": {"type": "array", "items": {"type": "string"}},
                "monetaryValues": {"type": "array", "items": {"type": "object", "properties": {"description": {"type": "string"}, "amount": {"type": ["number", "string"]}, "currency": {"type": "string"}}}},
                "financialDeadlines": {"type": "array", "items": {"type": "object", "properties": {"description": {"type": "string"}, "date": {"type": "string", "format": "date"}}}}
            }
        },
        # ... and so on for all your other sections like marketingImpact, salesImpact, etc.
        # Ensure the entire schema is defined here as a Python dictionary.
        "marketingImpact": {
            "type": "object",
            "properties": {
                "brandImplications": {"type": "array", "items": {"type": "string"}},
                "campaignEffects": {"type": "array", "items": {"type": "string"}},
                "marketPositioning": {"type": "array", "items": {"type": "string"}},
                "resourcesNeeded": {"type": "array", "items": {"type": "string"}},
                "communicationRequirements": {"type": "array", "items": {"type": "string"}}
            }
        },
        "salesImpact": {
             "type": "object",
             "properties": {
                 "salesTargets": {"type": "array", "items": {"type": "string"}},
                 "customerRelationships": {"type": "array", "items": {"type": "string"}},
                 "processChanges": {"type": "array", "items": {"type": "string"}},
                 "revenueProjections": {"type": "array", "items": {"type": "object", "properties": {"period": {"type": "string"}, "amount": {"type": ["number", "string"]}, "notes": {"type": "string"}}}},
                 "teamRequirements": {"type": "array", "items": {"type": "string"}}
             }
        },
        "legalImpact": {
            "type": "object",
            "properties": {
                "complianceRequirements": {"type": "array", "items": {"type": "string"}},
                "legalRisks": {"type": "array", "items": {"type": "string"}},
                "contractImplications": {"type": "array", "items": {"type": "string"}},
                "regulatoryConsiderations": {"type": "array", "items": {"type": "string"}},
                "requiredLegalActions": {"type": "array", "items": {"type": "string"}}
            }
        },
        "keyDates": {
            "type": "array",
            "items": {"type": "object", "properties": {"date": {"type": "string", "format": "date"},"description": {"type": "string"},"type": {"type": "string","enum": ["deadline", "implementation", "meeting", "review", "followup"]}}}
        },
        "keyStakeholders": {
            "type": "array",
            "items": {"type": "object", "properties": {"name": {"type": "string"},"role": {"type": "string"},"type": {"type": "string","enum": ["decision_maker", "team_member", "external_party", "required_participant"]},"responsibilities": {"type": "array", "items": {"type": "string"}}}}
        },
        "additionalImportantPoints": {
            "type": "object",
            "properties": {
                "technicalConsiderations": {"type": "array", "items": {"type": "string"}},
                "resourceRequirements": {"type": "array", "items": {"type": "string"}},
                "riskFactors": {"type": "array", "items": {"type": "object", "properties": {"description": {"type": "string"},"severity": {"type": "string","enum": ["low", "medium", "high", "critical"]},"mitigationPlan": {"type": "string"}}}},
                "dependencies": {"type": "array", "items": {"type": "string"}},
                "openQuestions": {"type": "array", "items": {"type": "string"}}
            }
        },
        "audioScript": {
            "type": "string",
            "description": "A concise, natural language summary script of the executive summary and main action items, written to be read aloud in under 30 seconds."
        },
        "metadata": {
            "type": "object",
            "properties": {
                "generatedDate": {"type": "string", "format": "date-time"},
                "lastUpdated": {"type": "string", "format": "date-time"},
                "version": {"type": "string"},
                "source": {"type": "string"}
            }
        }
    },
    "required": ["executiveSummary"]
}

def is_section_empty(section_data):
    """
    Recursively checks if a section of the parsed dictionary is empty or just contains "N/A".
    """
    if isinstance(section_data, str):
        return section_data.strip().lower() == 'n/a' or not section_data.strip()
    if isinstance(section_data, list):
        return not section_data
    if isinstance(section_data, dict):
        return all(is_section_empty(v) for v in section_data.values())
    return True # Default to empty if format is unrecognized

def extract_keys_from_schema(schema_dict: dict) -> set:
    """
    Recursively walks a JSON schema and extracts all possible key names
    from 'properties' sections.
    """
    keys = set()
    if isinstance(schema_dict, dict):
        # Check for properties in the current level
        if 'properties' in schema_dict and isinstance(schema_dict['properties'], dict):
            for key, value in schema_dict['properties'].items():
                keys.add(key)
                # Recursively call for nested objects
                keys.update(extract_keys_from_schema(value))
        
        # Check for properties within 'items' (for arrays of objects)
        if 'items' in schema_dict and isinstance(schema_dict['items'], dict):
            keys.update(extract_keys_from_schema(schema_dict['items']))
            
    return keys

schema_as_json_string = json.dumps(SCHEMA_DEFINITION, indent=2)

# STEP 3: Use an f-string to safely inject the perfect JSON string into your prompt.
# prompt_text = f"""
# You are a meticulous business analyst AI. 
# Your task is to analyze the email content and generate a structured summary based on a strict JSON template given below. 
# You must follow all instructions and formatting rules precisely.

# Core Instructions:
# Analyze: Carefully read the email provided at the end of this prompt.
# Extract: Identify the key message, all action items, responsible parties, deadlines, and financial details.
# Populate: Fill in the provided JSON Analysis Summary template using only the information from the email.
# Omit Empty Sections: If an entire numbered section  has no relevant information in the email, omit the entire section from your output.
# Handle Missing Subsections: If a specific subsection  has no relevant information, write N/A for its details.

# *** the JSON template is as follows:
# {schema_as_json_string}
# """

# prompt_text = f"""
# You are a meticulous business analyst AI. 
# Your task is to analyze the email content and generate a structured summary based on a strict JSON template given below. 
# You must follow all instructions and formatting rules precisely.

# Core Instructions:
# Analyze: Carefully read the email provided at the end of this prompt.
# Extract: Identify the key message, all action items, responsible parties, deadlines, and financial details.
# Populate: Fill in the provided JSON Analysis Summary template using only the information from the email.

# Classify: Analyze the sender, subject, and overall content to determine the email's primary category from the provided enum. Populate the `classification` object in the JSON output.
# - `category`: Assign the most fitting category. For example, personal replies are 'Primary Conversation', order confirmations are 'Transactional', sales offers are 'Promotions & Marketing', and internal company memos are 'Official/Work'.
# - `confidenceScore`: Provide a score from 0.0 to 1.0 indicating your certainty. A high score (e.g., 0.95) means you found very strong, unambiguous evidence. A low score (e.g., 0.6) means the evidence was weak or mixed.
# - `keywordsFound`: You **must** extract a list of up to 3 specific words or short phrases from the email that justify your category choice. Provide an empty list if none apply.

# Omit Empty Sections: If an entire section has no relevant information in the email, omit the entire section from your output.
# Handle Missing Subsections: If a specific subsection has no relevant information, write N/A for its details.

# *** the JSON template is as follows:
# {schema_as_json_string}
# """

prompt_text = f"""
You are a meticulous and highly intelligent business analyst AI. Your primary skill is to discern the true commercial intent of an email, looking past misleading marketing tactics.
Your task is to analyze the email content and generate a structured summary based on a strict JSON template given below. 
You must follow all instructions and formatting rules precisely.

---
Core Instructions:

1.  **Analyze:** Carefully read the entire email provided at the end of this prompt, including the headers, body, and footer.
2.  **Extract:** Identify the key message, all action items, responsible parties, deadlines, and financial details.
3.  **Populate:** Fill in the provided JSON Analysis Summary template using only the information from the email.
4.  **Classify:** Based on your analysis, populate the `classification` object in the JSON output.

---
Advanced Instructions for Classification:

-   **Prioritize the Primary Goal:** Your most important task is to determine the sender's ultimate goal. Ask yourself: "What does the sender want the user to *do*?" If the goal is to get the user to sign up, upgrade, "get started," or purchase something new, the category is **Promotional**, even if the email mentions a past purchase.
-   **Beware of Disguised Emails:** Marketing emails will often contain phrases like "you are receiving this because you are a customer" to seem transactional. You must recognize this tactic. The true category is defined by the main call-to-action (e.g., "Grow your business," "Get started"), not the legal text in the footer.
-   **Confidence Score Nuance:** Use a lower confidence score (e.g., 0.75-0.85) if you detect conflicting signals like this. Use a very high score (0.95+) only when all signals (sender, subject, body, call-to-action) are in perfect alignment.
-   **Keywords Justification:** Your `keywordsFound` must reflect the *true intent*. For the GoDaddy email, good keywords would be "Grow your business," "AI-augmented experience," and "Keep Going," as these point to the promotional goal.

---
Formatting Rules:

-   Omit Empty Sections: If an entire section has no relevant information in the email, omit the entire section from your output.
-   Handle Missing Subsections: If a specific subsection has no relevant information, provide an empty list `[]` for arrays or "N/A" for strings.

---
Generate Audio Script: After completing the rest of the JSON, create a concise, natural-language paragraph for the `audioScript` field.
- The script must be written as if an executive assistant is reading a summary aloud.
- It must ONLY include the most critical points from the `executiveSummary` and a brief mention of the main `actionItems`.
- Begin with a natural phrase like 'Here's a quick summary...' or 'In short...'.
- Keep the entire script under 50 words for a quick listening experience.

*** The JSON template you MUST follow is:
{schema_as_json_string}
"""

# STEP 4: Dynamically generate the keys directly from the clean Python dictionary.
# This line no longer needs to parse a string and will not fail.
ALL_SCHEMA_KEYS = extract_keys_from_schema(SCHEMA_DEFINITION)


# Find the start and end of the JSON schema within the prompt string
json_start = prompt_text.find('{')
json_end = prompt_text.rfind('}') + 1
schema_str = prompt_text[json_start:json_end]

# Load the schema string into a Python dictionary
schema_dict = json.loads(schema_str)

# DYNAMICALLY generate the complete set of all keys from your schema
ALL_SCHEMA_KEYS = extract_keys_from_schema(schema_dict)

# Initialize Google Cloud Vision client with error handling
try:
    from google.cloud import vision
    vision_client = vision.ImageAnnotatorClient()
    VISION_API_AVAILABLE = True
    logger.info("[OCR] Google Cloud Vision API initialized successfully")
except ImportError as e:
    logger.warning(f"[OCR] Google Cloud Vision API not available: {str(e)}")
    logger.warning("[OCR] Falling back to alternative OCR methods")
    vision_client = None
    VISION_API_AVAILABLE = False
except Exception as e:
    logger.error(f"[OCR] Error initializing Google Cloud Vision API: {str(e)}")
    vision_client = None
    VISION_API_AVAILABLE = False

# OCR Service Functions
def extract_text_from_image_url(image_url, image_name="unknown"):
    """
    Extract text from image URL using Google Cloud Vision API
    """
    if not VISION_API_AVAILABLE:
        logger.warning(f"[OCR] Vision API not available, cannot process image URL: {image_url}")
        return {"text": "", "confidence": 0, "error": "Vision API not available"}
    
    try:
        logger.info(f"[OCR] Fetching image from URL: {image_url}")
        
        # Fetch the image from URL
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
        response = requests.get(image_url, headers=headers, timeout=30)
        response.raise_for_status()
        
        # Check if the response is actually an image
        content_type = response.headers.get('content-type', '').lower()
        if not content_type.startswith('image/'):
            logger.warning(f"[OCR] URL does not return an image. Content-Type: {content_type}")
            return {"text": "", "confidence": 0, "error": f"Not an image: {content_type}"}
        
        # Create Vision API image object
        image_data = response.content
        image = vision.Image(content=image_data)
        
        # Perform OCR
        ocr_response = vision_client.text_detection(image=image)
        texts = ocr_response.text_annotations
        
        if ocr_response.error.message:
            raise Exception(f"Vision API error: {ocr_response.error.message}")
        
        if not texts:
            logger.info(f"[OCR] No text detected in image from URL: {image_url}")
            return {"text": "", "confidence": 0}
        
        # First annotation contains the full text
        full_text = texts[0].description
        
        # Calculate average confidence (Vision API doesn't always provide confidence)
        confidence = 0.9  # Default high confidence for successful detection
        
        logger.info(f"[OCR] Successfully extracted {len(full_text)} characters from image URL: {image_url}")
        
        return {
            "text": full_text,
            "confidence": confidence
        }
        
    except requests.RequestException as e:
        logger.error(f"[OCR] Error fetching image from URL {image_url}: {str(e)}")
        return {"text": "", "confidence": 0, "error": f"Fetch error: {str(e)}"}
    except Exception as e:
        logger.error(f"[OCR] Error processing image from URL {image_url}: {str(e)}")
        return {"text": "", "confidence": 0, "error": str(e)}

def extract_text_from_image_base64(image_base64, image_name="unknown"):
    """
    Extract text from base64 encoded image using Google Cloud Vision API
    """
    if not VISION_API_AVAILABLE:
        logger.warning(f"[OCR] Vision API not available, cannot process image: {image_name}")
        return {"text": "", "confidence": 0, "error": "Vision API not available"}
    
    try:
        logger.info(f"[OCR] Processing image: {image_name}")
        
        # Decode base64 image
        image_data = base64.b64decode(image_base64)
        image = vision.Image(content=image_data)
        
        # Perform OCR
        response = vision_client.text_detection(image=image)
        texts = response.text_annotations
        
        if response.error.message:
            raise Exception(f"Vision API error: {response.error.message}")
        
        if not texts:
            logger.info(f"[OCR] No text detected in image: {image_name}")
            return {"text": "", "confidence": 0}
        
        # First annotation contains the full text
        full_text = texts[0].description
        
        # Calculate average confidence (Vision API doesn't always provide confidence)
        confidence = 0.9  # Default high confidence for successful detection
        
        logger.info(f"[OCR] Successfully extracted {len(full_text)} characters from image: {image_name}")
        
        return {
            "text": full_text,
            "confidence": confidence
        }
        
    except Exception as e:
        logger.error(f"[OCR] Error processing image {image_name}: {str(e)}")
        return {"text": "", "confidence": 0, "error": str(e)}

def process_email_with_images(email_data):
    """
    Process email data and extract text from any images
    Handles multiple image sources: inline base64, attachments, embedded images, and external URLs
    """
    # Extract basic email content
    email_body = email_data.get('body', '')
    image_content = []
    
    logger.info(f"[OCR] Processing email for images. Body length: {len(email_body) if email_body else 0}")
    
    # Check 1: Look for inline base64 images in HTML content
    if email_body:
        # Pattern for base64 embedded images: data:image/type;base64,data
        base64_pattern = r'<img[^>]+src="data:image/([^;]+);base64,([^"]+)"[^>]*>'
        base64_matches = re.findall(base64_pattern, email_body)
        
        logger.info(f"[OCR] Found {len(base64_matches)} inline base64 images")
        
        for i, (img_type, img_data) in enumerate(base64_matches):
            image_name = f"inline_image_{i+1}.{img_type}"
            logger.info(f"[OCR] Processing inline image: {image_name}")
            
            try:
                ocr_result = extract_text_from_image_base64(img_data, image_name)
                
                if ocr_result["text"]:
                    image_content.append({
                        "imageName": image_name,
                        "extractedText": ocr_result["text"]
                    })
                    logger.info(f"[OCR] Successfully extracted text from {image_name}: {len(ocr_result['text'])} characters")
                else:
                    logger.info(f"[OCR] No text found in {image_name}")
            except Exception as e:
                logger.error(f"[OCR] Failed to process inline image {image_name}: {str(e)}")
    
    # Check 2: Look for external image URLs (like in your screenshot)
    if email_body:
        # Pattern for external image URLs: src="http://..." or src="https://..."
        url_pattern = r'<img[^>]+src="(https?://[^"]+)"[^>]*>'
        url_matches = re.findall(url_pattern, email_body)
        
        logger.info(f"[OCR] Found {len(url_matches)} external image URLs")
        
        for i, img_url in enumerate(url_matches):
            image_name = f"external_image_{i+1}"
            logger.info(f"[OCR] Processing external image: {image_name} from URL: {img_url}")
            
            try:
                # Fetch and process external image
                ocr_result = extract_text_from_image_url(img_url, image_name)
                
                if ocr_result["text"]:
                    image_content.append({
                        "imageName": image_name,
                        "extractedText": ocr_result["text"],
                        "imageUrl": img_url
                    })
                    logger.info(f"[OCR] Successfully extracted text from {image_name}: {len(ocr_result['text'])} characters")
                else:
                    logger.info(f"[OCR] No text found in {image_name}")
            except Exception as e:
                logger.error(f"[OCR] Failed to process external image {image_name}: {str(e)}")
    
    # Check 3: Look for image references that might indicate attachments
    image_references = []
    if email_body:
        # Pattern for CID (Content-ID) references: src="cid:image001.jpg"
        cid_pattern = r'src="cid:([^"]+)"'
        cid_matches = re.findall(cid_pattern, email_body)
        image_references.extend(cid_matches)
        
        # Pattern for attachment references: src="attachment:filename"
        attachment_pattern = r'src="attachment:([^"]+)"'
        attachment_matches = re.findall(attachment_pattern, email_body)
        image_references.extend(attachment_matches)
        
        # Pattern for regular image tags that might reference external or embedded images
        img_src_pattern = r'<img[^>]+src="([^"]+)"[^>]*>'
        img_matches = re.findall(img_src_pattern, email_body)
        
        # Filter out data: URLs (already processed) and http/https URLs (already processed)
        for src in img_matches:
            if not src.startswith(('data:', 'http:', 'https:')):
                image_references.append(src)
    
    if image_references:
        logger.info(f"[OCR] Found {len(image_references)} image references that may need attachment processing: {image_references}")
    
    # Check 4: Look for email attachments (if provided by email service)
    attachments = email_data.get('attachments', [])
    if attachments:
        logger.info(f"[OCR] Found {len(attachments)} attachments to check for images")
        
        for attachment in attachments:
            filename = attachment.get('filename', '')
            mime_type = attachment.get('mimeType', '')
            content = attachment.get('content', '')  # base64 encoded content
            
            # Check if attachment is an image
            if is_image_attachment(filename, mime_type):
                logger.info(f"[OCR] Processing image attachment: {filename}")
                
                try:
                    ocr_result = extract_text_from_image_base64(content, filename)
                    
                    if ocr_result["text"]:
                        image_content.append({
                            "imageName": filename,
                            "extractedText": ocr_result["text"]
                        })
                        logger.info(f"[OCR] Successfully extracted text from attachment {filename}: {len(ocr_result['text'])} characters")
                    else:
                        logger.info(f"[OCR] No text found in attachment {filename}")
                except Exception as e:
                    logger.error(f"[OCR] Failed to process attachment {filename}: {str(e)}")
    
    # Check 5: Look for common image indicators in email content
    has_image_indicators = check_for_image_indicators(email_body)
    
    logger.info(f"[OCR] Email processing complete. Found {len(image_content)} images with text")
    logger.info(f"[OCR] Image indicators detected: {has_image_indicators}")
    
    return {
        "emailBody": email_body,
        "imageContent": image_content,
        "attachmentContent": [],  # TODO: Add attachment processing for non-images
        "hasImages": len(image_content) > 0 or len(image_references) > 0 or has_image_indicators,
        "imageReferences": image_references,
        "imageIndicators": has_image_indicators
    }

def is_image_attachment(filename, mime_type):
    """
    Check if an attachment is an image based on filename and MIME type
    """
    if not filename and not mime_type:
        return False
    
    # Check MIME type first (most reliable)
    if mime_type:
        return mime_type.startswith('image/')
    
    # Check file extension as fallback
    if filename:
        image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.svg']
        filename_lower = filename.lower()
        return any(filename_lower.endswith(ext) for ext in image_extensions)
    
    return False

def check_for_image_indicators(email_body):
    """
    Check for common indicators that an email contains images
    """
    if not email_body:
        return []
    
    indicators = []
    
    # Check for image-related HTML tags
    if '<img' in email_body.lower():
        indicators.append('img_tags')
    
    # Check for common image-related text
    image_keywords = [
        'see attached image', 'image attached', 'screenshot', 'chart', 'graph', 
        'diagram', 'photo', 'picture', 'visual', 'see below', 'attached file',
        'please find attached', 'image shows', 'as shown in', 'refer to image'
    ]
    
    email_lower = email_body.lower()
    for keyword in image_keywords:
        if keyword in email_lower:
            indicators.append(f'keyword_{keyword.replace(" ", "_")}')
    
    # Check for CID references
    if 'cid:' in email_body:
        indicators.append('cid_references')
    
    # Check for attachment references
    if 'attachment:' in email_body:
        indicators.append('attachment_references')
    
    return indicators

# # Intelligent Markdown Cleaner and HTML Converter
# class IntelligentMarkdownProcessor:
    
#     @staticmethod
#     def clean_markdown_response(raw_markdown):
#         """
#         Comprehensively clean and format markdown response from AI
#         """
#         if not raw_markdown or not raw_markdown.strip():
#             return "No summary available"
        
#         processor = IntelligentMarkdownProcessor()
        
#         # Step 1: Normalize and pre-process
#         content = processor._deep_normalize(raw_markdown.strip())
        
#         # Step 2: Fix all structural and formatting issues BEFORE markdown conversion
#         content = processor._comprehensive_fix(content)
        
#         # Step 3: Final validation and cleanup
#         content = processor._final_cleanup(content)
        
#         return content
    
#     def _deep_normalize(self, content):
#         """Deep normalization of content"""
#         # Normalize line endings and whitespace
#         content = content.replace('\r\n', '\n').replace('\r', '\n')
        
#         # Split into lines for processing
#         lines = content.split('\n')
#         normalized_lines = []
        
#         for line in lines:
#             # Remove excessive whitespace but preserve intentional indentation
#             if line.strip():
#                 # Keep leading whitespace for indented content, clean trailing
#                 leading_space = len(line) - len(line.lstrip())
#                 cleaned_content = line.strip()
#                 normalized_lines.append(' ' * min(leading_space, 4) + cleaned_content)
#             else:
#                 normalized_lines.append('')
        
#         return '\n'.join(normalized_lines)
    
#     def _comprehensive_fix(self, content):
#         """Fix all issues comprehensively before markdown conversion"""
#         lines = content.split('\n')
#         fixed_lines = []
#         current_section_type = None
        
#         for i, line in enumerate(lines):
#             original_line = line
#             stripped = line.strip()
            
#             if not stripped:
#                 fixed_lines.append(line)
#                 continue
            
#             # Determine what type of content this is
#             content_type = self._identify_content_type(stripped)
            
#             # Fix based on content type
#             if content_type == 'title':
#                 fixed_line = self._fix_title(stripped)
#                 current_section_type = 'title'
                
#             elif content_type == 'section_heading':
#                 fixed_line = self._fix_section_heading(stripped)
#                 current_section_type = 'section'
                
#             elif content_type == 'subsection_heading':
#                 fixed_line = self._fix_subsection_heading(stripped)
#                 current_section_type = 'subsection'
                
#             elif content_type == 'checkbox':
#                 fixed_line = self._fix_checkbox_comprehensive(stripped)
                
#             elif content_type == 'list_item':
#                 fixed_line = self._fix_list_item_comprehensive(stripped)
                
#             elif content_type == 'responsibility':
#                 fixed_line = self._fix_responsibility(stripped)
                
#             elif content_type == 'deadline':
#                 fixed_line = self._fix_deadline(stripped)
                
#             elif content_type == 'regular_text':
#                 fixed_line = self._fix_regular_text(stripped, current_section_type)
                
#             else:
#                 fixed_line = self._fix_text_formatting(stripped)
            
#             fixed_lines.append(fixed_line)
        
#         return '\n'.join(fixed_lines)
    
#     def _identify_content_type(self, line):
#         """Identify what type of content this line represents"""
#         if 'Email Analysis Summary' in line:
#             return 'title'
#         elif re.match(r'^#{0,6}\s*\d+\.\s+', line):
#             return 'section_heading'
#         elif re.match(r'^#{0,6}\s*[A-Za-z][^:]*$', line) and len(line.split()) <= 5:
#             return 'subsection_heading'
#         elif re.match(r'^[-*+]?\s*\[\s*[x\s]*\]\s*', line, re.IGNORECASE):
#             return 'checkbox'
#         elif re.match(r'^[-*+]\s+', line):
#             return 'list_item'
#         elif re.match(r'^\*\*[^*]+\*\*:\s*$', line):
#             return 'responsibility'
#         elif re.match(r'^\*\*[^*]+\*\*:\s*.+', line):
#             return 'deadline'
#         elif re.match(r'^(Generated|Version|Source):', line):
#             return 'metadata'
#         else:
#             return 'regular_text'
    
#     def _fix_title(self, line):
#         """Fix title formatting"""
#         return '# Email Analysis Summary'
    
#     def _fix_section_heading(self, line):
#         """Fix section heading formatting"""
#         # Extract section number and title
#         match = re.match(r'^#{0,6}\s*(\d+)\.\s*(.+)', line)
#         if match:
#             num, title = match.groups()
#             return f'## {num}. {title.strip()}'
#         return f'## {line.strip()}'
    
#     def _fix_subsection_heading(self, line):
#         """Fix subsection heading formatting"""
#         clean_title = re.sub(r'^#{0,6}\s*', '', line).strip()
#         return f'### {clean_title}'
    
#     def _fix_checkbox_comprehensive(self, line):
#         """Comprehensively fix checkbox formatting"""
#         # Remove any existing list markers and checkbox brackets
#         content = re.sub(r'^[-*+]?\s*\[\s*[x\s]*\]\s*', '', line, flags=re.IGNORECASE)
        
#         # Determine if it should be checked
#         is_checked = bool(re.search(r'\[x\]', line, re.IGNORECASE))
        
#         # Return proper checkbox format
#         checkbox_marker = '- [x]' if is_checked else '- [ ]'
#         return f'{checkbox_marker} {content.strip()}'
    
#     def _fix_list_item_comprehensive(self, line):
#         """Comprehensively fix list item formatting"""
#         # Extract content after any list marker
#         content = re.sub(r'^[-*+]\s*', '', line).strip()
        
#         # Handle malformed items like "-Word" -> "- Word"
#         content = re.sub(r'^([A-Z])', r'\1', content)
        
#         return f'- {content}'
    
#     def _fix_responsibility(self, line):
#         """Fix responsibility formatting"""
#         match = re.match(r'^\*\*([^*]+)\*\*:\s*$', line)
#         if match:
#             return f'**{match.group(1).strip()}:**'
#         return line
    
#     def _fix_deadline(self, line):
#         """Fix deadline formatting"""
#         match = re.match(r'^\*\*([^*]+)\*\*:\s*(.+)', line)
#         if match:
#             date_part, desc_part = match.groups()
#             return f'**{date_part.strip()}:** {desc_part.strip()}'
#         return line
    
#     def _fix_regular_text(self, line, section_type):
#         """Fix regular text with context awareness"""
#         # Apply text formatting fixes
#         fixed = self._fix_text_formatting(line)
        
#         # Context-aware fixes - convert plain text to lists in certain sections
#         if section_type in ['subsection'] and len(fixed) > 15 and not fixed.startswith(('**', '-', '*', '+')):
#             # This might be content that should be a list item
#             if not re.match(r'^(Generated|Version|Source):', fixed):
#                 return f'- {fixed}'
        
#         return fixed
    
#     def _fix_text_formatting(self, line):
#         """Fix text formatting issues comprehensively"""
#         # Fix bold text first
#         line = re.sub(r'\*\*\s*([^*]+?)\s*\*\*', r'**\1**', line)
        
#         # Fix spacing around bold text - handle all cases
#         # Case 1: word**bold**word -> word **bold** word
#         line = re.sub(r'(\w)\*\*([^*]+?)\*\*(\w)', r'\1 **\2** \3', line)
        
#         # Case 2: **bold**word -> **bold** word  
#         line = re.sub(r'\*\*([^*]+?)\*\*([a-zA-Z])', r'**\1** \2', line)
        
#         # Case 3: word**bold** -> word **bold**
#         line = re.sub(r'([a-zA-Z])\*\*([^*]+?)\*\*', r'\1 **\2**', line)
        
#         # Fix spacing with punctuation - CRITICAL FIX
#         # **bold** 's -> **bold**'s (remove space before apostrophe)
#         line = re.sub(r'\*\*([^*]+?)\*\*\s+([\'\.,;:!?])', r'**\1**\2', line)
        
#         # Fix word concatenation
#         line = re.sub(r'([a-z])([A-Z][a-z])', r'\1 \2', line)
        
#         # Fix specific concatenation patterns
#         line = re.sub(r'(\w)(and|or|on|in|at|to|for|with|by)([A-Z])', r'\1 \2 \3', line)
        
#         # Fix emoji spacing
#         line = re.sub(r'([💰💸📊💵⏰])\s*([^\s\n])', r'\1 \2', line)
        
#         return line
    
#     def _final_cleanup(self, content):
#         """Final cleanup and optimization"""
#         lines = content.split('\n')
#         cleaned_lines = []
#         prev_was_empty = False
        
#         for line in lines:
#             is_empty = not line.strip()
            
#             # Prevent more than one consecutive empty line
#             if is_empty and prev_was_empty:
#                 continue
                
#             cleaned_lines.append(line)
#             prev_was_empty = is_empty
        
#         # Remove leading and trailing empty lines
#         while cleaned_lines and not cleaned_lines[0].strip():
#             cleaned_lines.pop(0)
#         while cleaned_lines and not cleaned_lines[-1].strip():
#             cleaned_lines.pop()
        
#         return '\n'.join(cleaned_lines)
    
#     @staticmethod
#     def convert_to_html(cleaned_markdown):
#         """Convert cleaned markdown to HTML with post-processing fixes"""
        
#         if not cleaned_markdown or not cleaned_markdown.strip():
#             return "<p>No summary available</p>"
        
#         # Convert markdown to HTML
#         md = markdown.Markdown(extensions=[
#             'markdown.extensions.extra',
#             'markdown.extensions.codehilite'
#         ])
        
#         html_content = md.convert(cleaned_markdown)
        
#         # Apply comprehensive post-processing
#         processor = IntelligentMarkdownProcessor()
#         html_content = processor._post_process_html(html_content)
        
#         return html_content
    
#     def _post_process_html(self, html_content):
#         """Comprehensive HTML post-processing"""
        
#         # First, fix any issues the markdown converter created
#         html_content = self._fix_markdown_converter_issues(html_content)
        
#         # Then apply styling and enhancements
#         html_content = self._apply_comprehensive_styling(html_content)
        
#         return html_content
    
#     def _fix_markdown_converter_issues(self, html_content):
#         """Fix issues created by the markdown converter"""
        
#         # Fix checkboxes that got converted incorrectly - handle ALL variations
#         # Pattern 1: <li>- [ ] content</li> -> proper checkbox
#         html_content = re.sub(
#             r'<li>-\s*\[\s*\]\s*([^<]+)</li>',
#             r'<li class="checkbox-item"><input type="checkbox" disabled> <span>\1</span></li>',
#             html_content
#         )
        
#         # Pattern 2: <li>- [x] content</li> -> checked checkbox
#         html_content = re.sub(
#             r'<li>-\s*\[x\]\s*([^<]+)</li>',
#             r'<li class="checkbox-item"><input type="checkbox" checked disabled> <span>\1</span></li>',
#             html_content,
#             flags=re.IGNORECASE
#         )
        
#         # Pattern 3: <li>[ ] content</li> -> proper checkbox (without dash)
#         html_content = re.sub(
#             r'<li>\[\s*\]\s*([^<]+)</li>',
#             r'<li class="checkbox-item"><input type="checkbox" disabled> <span>\1</span></li>',
#             html_content
#         )
        
#         # Pattern 4: <li>[x] content</li> -> checked checkbox (without dash)
#         html_content = re.sub(
#             r'<li>\[x\]\s*([^<]+)</li>',
#             r'<li class="checkbox-item"><input type="checkbox" checked disabled> <span>\1</span></li>',
#             html_content,
#             flags=re.IGNORECASE
#         )
        
#         # Fix checkbox patterns in paragraphs
#         html_content = re.sub(
#             r'<p>-?\s*\[\s*\]\s*([^<]+)</p>',
#             r'<div class="checkbox-item"><input type="checkbox" disabled> <span>\1</span></div>',
#             html_content
#         )
        
#         html_content = re.sub(
#             r'<p>-?\s*\[x\]\s*([^<]+)</p>',
#             r'<div class="checkbox-item"><input type="checkbox" checked disabled> <span>\1</span></div>',
#             html_content,
#             flags=re.IGNORECASE
#         )
        
#         # Fix plain text checkboxes that appear as text
#         html_content = re.sub(
#             r'(\[\s*\])\s*([^<\n]+)',
#             r'<input type="checkbox" disabled style="margin-right: 0.5em;"> <span>\2</span>',
#             html_content
#         )
        
#         html_content = re.sub(
#             r'(\[x\])\s*([^<\n]+)',
#             r'<input type="checkbox" checked disabled style="margin-right: 0.5em;"> <span>\2</span>',
#             html_content,
#             flags=re.IGNORECASE
#         )
        
#         return html_content
    
#     def _apply_comprehensive_styling(self, html_content):
#         """Apply comprehensive styling to HTML"""
        
#         # Define all styles upfront
#         styles = {
#             'container': 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 100%; padding: 1.5em; background: #fff;',
#             'h1': 'font-size: 2.2em; font-weight: bold; margin: 0 0 1.5em 0; color: #1a365d; border-bottom: 3px solid #3182ce; padding-bottom: 0.5em;',
#             'h2': 'font-size: 1.6em; font-weight: bold; margin: 2.5em 0 1em 0; color: #2d3748; border-bottom: 2px solid #4299e1; padding-bottom: 0.3em;',
#             'h3': 'font-size: 1.3em; font-weight: 600; margin: 1.8em 0 0.8em 0; color: #4a5568;',
#             'ul': 'margin: 1em 0; padding-left: 1.5em; list-style-type: disc;',
#             'li': 'margin: 0.4em 0; line-height: 1.5;',
#             'checkbox_li': 'list-style: none; margin: 0.6em 0; position: relative; padding-left: 0; display: flex; align-items: flex-start;',
#             'checkbox_input': 'margin-right: 0.5em; margin-top: 0.1em; transform: scale(1.1); flex-shrink: 0;',
#             'responsibility': 'font-weight: 600; margin: 1.5em 0 0.8em 0; color: #2d3748; font-size: 1.1em; background: #f7fafc; padding: 0.5em; border-radius: 4px; border-left: 3px solid #4299e1;',
#             'deadline': 'margin: 0.8em 0; padding: 0.8em; background: linear-gradient(135deg, #fff5f5, #ffe8e8); border-left: 4px solid #e53e3e; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);',
#             'deadline_date': 'font-weight: bold; color: #c53030; font-size: 1.05em;',
#             'financial': 'margin: 0.5em 0; padding: 0.6em; background: #f7fafc; border-radius: 6px; border-left: 3px solid #38b2ac;',
#             'emoji': 'margin-right: 0.6em; font-size: 1.2em;'
#         }
        
#         # Apply heading styles with clear hierarchy
#         html_content = re.sub(r'<h1>', f'<h1 style="{styles["h1"]}">', html_content)
#         html_content = re.sub(r'<h2>', f'<h2 style="{styles["h2"]}">', html_content)
#         html_content = re.sub(r'<h3>', f'<h3 style="{styles["h3"]}">', html_content)
        
#         # Apply list styles
#         html_content = re.sub(r'<ul>', f'<ul style="{styles["ul"]}">', html_content)
        
#         # Style regular list items
#         html_content = re.sub(r'<li>(?!<)', f'<li style="{styles["li"]}">', html_content)
        
#         # Style checkbox items specifically
#         html_content = re.sub(
#             r'<li class="checkbox-item">',
#             f'<li class="checkbox-item" style="{styles["checkbox_li"]}">',
#             html_content
#         )
        
#         # Style checkbox inputs
#         html_content = re.sub(
#             r'<input type="checkbox"([^>]*)>',
#             f'<input type="checkbox"\\1 style="{styles["checkbox_input"]}">',
#             html_content
#         )
        
#         # Handle financial items with emojis
#         for emoji in ['💰', '💸', '📊', '💵', '⏰']:
#             html_content = re.sub(
#                 f'<li[^>]*>\\s*{re.escape(emoji)}\\s*([^<]+)</li>',
#                 f'<li style="{styles["financial"]}"><span style="{styles["emoji"]}">{emoji}</span><span>\\1</span></li>',
#                 html_content
#             )
        
#         # Handle responsibility sections
#         html_content = re.sub(
#             r'<p><strong>([^<]+?):</strong></p>',
#             f'<div style="{styles["responsibility"]}">\\1:</div>',
#             html_content
#         )
        
#         # Handle responsibility sections that might be in different formats
#         html_content = re.sub(
#             r'<p><strong>([^<]+?)</strong>:\s*</p>',
#             f'<div style="{styles["responsibility"]}">\\1:</div>',
#             html_content
#         )
        
#         # Handle inline responsibility format
#         html_content = re.sub(
#             r'<p><strong>([^<]+?):</strong>\s*([^<]+?)</p>',
#             f'<div style="{styles["responsibility"]}">\\1:</div><p style="margin: 0.5em 0;">\\2</p>',
#             html_content
#         )
        
#         # Handle deadline formatting - make sure it doesn't conflict with responsibility
#         html_content = re.sub(
#             r'<p><strong>([^<]*?(?:PM|AM|UTC)[^<]*?):</strong>\s*([^<]+?)</p>',
#             f'<div style="{styles["deadline"]}"><span style="{styles["deadline_date"]}">\\1:</span> <span>\\2</span></div>',
#             html_content
#         )
        
#         # Wrap in styled container
#         html_content = f'<div style="{styles["container"]}">{html_content}</div>'
        
#         return html_content

   


def convert_dict_to_html(data_dict: dict) -> str:
    """
    Converts the parsed dictionary into a well-formatted and styled HTML block.
    Handles empty or null content gracefully.
    **NEW: Filters out schema keys and formats titles.**
    """
    if not data_dict or not isinstance(data_dict, dict):
        return "<p>No summary data available to display.</p>"

    html_parts = ['<div class="summary-container">']

    # --- HELPER FUNCTIONS ---
    def format_title(key_str: str) -> str:
        """Converts camelCase or snake_case to Title Case. e.g. executiveSummary -> Executive Summary"""
        return re.sub(r'(?<!^)(?=[A-Z])', ' ', key_str).replace('_', ' ').title()

    def render_list_of_dicts(items):
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list):
            return f"<p>{items}</p>"

        item_html = '<ul class="item-list">'
        for item in items:
            if isinstance(item, dict):
                item_html += '<li class="item-card">'
                for k, v in item.items():
                    key_title = format_title(k)
                    item_html += f'<div><strong>{key_title}:</strong> '
                    if isinstance(v, list):
                        item_html += "<ul>" + "".join(f"<li>{val}</li>" for val in v) + "</ul>"
                    else:
                        item_html += str(v)
                    item_html += '</div>'
                item_html += '</li>'
            else:
                item_html += f'<li>{item}</li>'
        item_html += '</ul>'
        return item_html

    # --- MAIN LOGIC ---
    # Define the schema keys to ignore
    SCHEMA_KEYS_TO_IGNORE = {'$schema', 'type', 'properties', 'required', 'items', 'format', 'enum'}

    # Filter out the schema keys at the top level of the dictionary
    data_to_render = {k: v for k, v in data_dict.items() if k not in SCHEMA_KEYS_TO_IGNORE}
    
    # If filtering leaves nothing, it was probably just a schema
    if not data_to_render:
        return "<p><em>No actionable summary could be generated from this email.</em></p>"

    for major_key, minor_data in data_to_render.items():
        html_parts.append(f'<h4>{format_title(major_key)}</h4>')

        if isinstance(minor_data, dict):
            # Also filter schema keys from nested objects
            filtered_minor_data = {k: v for k, v in minor_data.items() if k not in SCHEMA_KEYS_TO_IGNORE}
            for minor_key, content in filtered_minor_data.items():
                html_parts.append(f'<h5>{format_title(minor_key)}</h5>')
                if not content and not isinstance(content, bool):
                    html_parts.append('<p><em>N/A</em></p>')
                elif isinstance(content, list):
                    html_parts.append(render_list_of_dicts(content))
                else:
                    html_parts.append(f'<p>{str(content)}</p>')
        elif isinstance(minor_data, list):
            if not minor_data:
                html_parts.append('<p><em>N/A</em></p>')
            else:
                html_parts.append(render_list_of_dicts(minor_data))
        else:
             html_parts.append(f'<p>{str(minor_data)}</p>')


    html_parts.append('</div>')
    
    # Prepend the existing CSS styles string
    css_styles = """<style> ... </style>""" # (Your full CSS string here)
    return css_styles + "".join(html_parts)


# In your Python script (e.g., app.py)
# This is the FINAL and DEFINITIVE version of the parser.

import re

# In your Python script (e.g., app.py)
# This is the FINAL and DEFINITIVE version of the parser.

import re
from collections import defaultdict

# def parse_summary_to_dict(text_summary: str, **kwargs) -> dict:
#     """
#     A definitive, resilient parser. It first groups all lines by indentation,
#     then explicitly finds and restructures classification data and other special
#     sections like tasks into their correct nested format.
#     """
#     lines = [line for line in text_summary.strip().split('\n') if line.strip()]
#     if not lines:
#         return {}

#     # Step 1: A simple first pass to group lines under their parent headers based on indentation
#     # This creates a dictionary where values are lists of strings.
#     raw_groups = defaultdict(list)
#     path = []
#     indent_levels = {}

#     for line in lines:
#         indent = len(line) - len(line.lstrip(' '))
        
#         while path and indent <= indent_levels.get(path[-1], -1):
#             path.pop()

#         parent_key = path[-1] if path else None
        
#         if parent_key:
#             raw_groups[parent_key].append(line.strip())
#         else:
#             # This is a top-level key
#             key = line.strip()
#             path.append(key)
#             indent_levels[key] = indent
#             raw_groups[key] = [] # Initialize its list

#     # Step 2: Post-process the raw groups into the final, structured dictionary
#     final_dict = {}
#     classification_data = {}
#     CLASSIFICATION_KEYS = {'category', 'confidence score', 'keywords found'}

#     for key, values in raw_groups.items():
#         normalized_key = key.lower().replace(" ", "")

#         # Find and pull out all classification data into a separate object
#         if normalized_key in CLASSIFICATION_KEYS:
#             classification_data[normalized_key] = "\n".join(values)
#             continue # Skip adding it to the main dict for now

#         # Handle other sections
#         section_content = {}
#         if not values:
#             final_dict[key] = {}
#             continue

#         # Special handling for 'tasks' which use the 'Key: Value' format
#         if key == 'tasks':
#             tasks_list = []
#             current_task = {}
#             for v_line in values:
#                 match = re.match(r'([A-Za-z]+):\s*(.*)', v_line)
#                 if match:
#                     t_key, t_val = match.groups()
#                     if t_key.lower() == 'description' and current_task:
#                         tasks_list.append(current_task)
#                         current_task = {}
#                     current_task[t_key.lower()] = t_val
#             if current_task:
#                 tasks_list.append(current_task)
#             section_content = tasks_list
#         else:
#             # Handle sections with simple sub-keys or lists of strings
#             sub_key = None
#             buffer = []
#             for v_line in values + ['']: # Add sentinel for flushing
#                 # Check if line is a sub-key (single or two words, camelCase or Title Case)
#                 if len(v_line.split()) <= 2 and re.match(r'^[a-zA-Z][a-zA-Z]*$', v_line.replace(" ", "")):
#                     if sub_key and buffer:
#                         section_content[sub_key] = "\n".join(buffer)
#                     sub_key = v_line
#                     buffer = []
#                 else:
#                     if v_line:
#                         buffer.append(v_line)
#             if sub_key and buffer:
#                 section_content[sub_key] = "\n".join(buffer)

#         # If a section only has one value, don't nest it
#         if not section_content and len(values) == 1:
#             final_dict[key] = values[0]
#         elif not section_content and len(values) > 1:
#              final_dict[key] = values
#         else:
#             final_dict[key] = section_content
            
#     # Step 3: Add the properly nested classification object to the final dictionary
#     if classification_data:
#         final_dict['classification'] = {
#             'category': classification_data.get('category'),
#             'confidenceScore': float(classification_data.get('confidence score', 0.0)),
#             'keywordsFound': classification_data.get('keywords found', '').split('\n')
#         }

#     return final_dict


# def parse_summary_to_dict(text_summary: str, **kwargs) -> dict:
#     """
#     A definitive, resilient parser that uses indentation and pattern matching
#     to build a nested dictionary. It specifically finds and groups all
#     classification-related data into a nested 'classification' object.
#     """
#     lines = text_summary.strip().split('\n')
#     parsed_data = {}
    
#     # Use a stack to keep track of the current nesting level
#     # Format: (indent_level, dictionary_pointer)
#     stack = [(-1, parsed_data)]
    
#     # --- Special logic to gather all classification details ---
#     classification_details = {}
#     CLASSIFICATION_KEYS = {'category', 'confidence score', 'keywords found'}

#     for line in lines:
#         stripped_line = line.strip()
#         if not stripped_line:
#             continue

#         indent_level = len(line) - len(line.lstrip(' '))
        
#         # Check for our special 'Key: Value' format (e.g., for tasks)
#         record_match = re.match(r'([A-Za-z\s]+):\s*(.*)', stripped_line)

#         # Find the correct parent in the hierarchy for the current line
#         while indent_level <= stack[-1][0]:
#             stack.pop()
#         parent_dict = stack[-1][1]

#         # Determine if the current line is a key or a value
#         is_key = True
#         last_key_in_parent = list(parent_dict.keys())[-1] if parent_dict else None

#         if last_key_in_parent and parent_dict.get(last_key_in_parent) is None:
#             # This line is the value for the previous key
#             parent_dict[last_key_in_parent] = stripped_line
#             is_key = False
        
#         if is_key:
#             # This line is a new key.
#             key = stripped_line
#             # Normalize the key for checking (lowercase, no spaces)
#             normalized_key = key.lower().replace(" ", "")

#             # --- THIS IS THE NEW LOGIC ---
#             # If it's a classification key, add it to our special dictionary
#             if normalized_key in CLASSIFICATION_KEYS:
#                 # Value will be assigned on the next iteration if it's on a new line
#                 classification_details[normalized_key] = None
#                 stack.append((indent_level, classification_details)) # Temporarily point to this dict
#             # Handle 'Key: Value' for tasks
#             elif record_match:
#                 key, value = record_match.groups()
#                 # This logic assumes tasks are under an 'actionItems' key
#                 if 'actionItems' not in parent_dict:
#                     parent_dict['actionItems'] = {}
#                 if 'tasks' not in parent_dict['actionItems']:
#                     parent_dict['actionItems']['tasks'] = []
                
#                 # Group consecutive Key:Value pairs into a single task object
#                 if key.lower() == 'description' or not parent_dict['actionItems']['tasks']:
#                      parent_dict['actionItems']['tasks'].append({}) # Start a new task
                
#                 # Add the key-value pair to the last task object
#                 parent_dict['actionItems']['tasks'][-1][key.lower()] = value
#             else:
#                 # It's a regular key
#                 parent_dict[key] = None
#                 # Create a new dictionary for this key and push it to the stack
#                 # for potential children.
#                 new_dict_for_key = {}
#                 parent_dict[key] = new_dict_for_key
#                 stack.append((indent_level, new_dict_for_key))

#     # After parsing all lines, if we collected any classification details,
#     # add them to the main parsed_data dictionary in the correct nested structure.
#     if classification_details:
#         # Clean up the None values from the classification details
#         final_classification = {}
#         if classification_details.get('category'):
#             final_classification['category'] = classification_details['category']
#         if classification_details.get('confidence score'):
#             # Convert score to number if possible
#             try:
#                 final_classification['confidenceScore'] = float(re.sub(r'[^\d.]', '', classification_details['confidence score']))
#             except (ValueError, TypeError):
#                  final_classification['confidenceScore'] = 0.0
#         if classification_details.get('keywords found'):
#             # Split keywords into a list
#             final_classification['keywordsFound'] = [kw.strip() for kw in classification_details['keywords found'].split('\n')]

#         parsed_data['classification'] = final_classification
        
#         # Remove the now-empty placeholder keys from the main dict
#         keys_to_delete = [k for k in parsed_data if k.lower().replace(" ", "") in CLASSIFICATION_KEYS]
#         for k in keys_to_delete:
#             del parsed_data[k]
            
#     return parsed_data


# def parse_summary_to_dict(text_summary: str, **kwargs) -> dict: # removed unused known_keys
#     """
#     A robust parser that builds a nested dictionary based on line indentation,
#     which is the most consistent structural clue from the AI's text output.
#     It also handles special 'Key: Value' formats for records like tasks.
#     """
#     lines = text_summary.strip().split('\n')
#     parsed_data = {}
    
#     # stack will hold pointers to the dictionaries at each indentation level
#     # Format: (indent_level, dictionary_pointer)
#     stack = [(-1, parsed_data)]
    
#     # --- Special handling for structured records (like 'tasks') ---
#     current_record_list_key = None
#     current_record = {}
#     record_start_keys = {'description', 'name', 'date'}

#     def flush_record():
#         """Saves any pending structured record (like a task)."""
#         nonlocal current_record
#         if current_record and current_record_list_key:
#             # The parent dict for the record list is the last one on the stack
#             parent_dict = stack[-1][1]
#             if current_record_list_key not in parent_dict:
#                 parent_dict[current_record_list_key] = []
#             parent_dict[current_record_list_key].append(current_record)
#             current_record = {}

#     for line in lines:
#         stripped_line = line.strip()
#         if not stripped_line:
#             continue
            
#         indent_level = len(line) - len(line.lstrip(' '))

#         # --- Logic for structured 'Key: Value' lines (e.g., within 'tasks') ---
#         match = re.match(r'([A-Za-z\s]+):\s*(.*)', stripped_line)
#         if match:
#             key, value = match.groups()
#             key_clean = key.lower().strip()

#             if key_clean in record_start_keys and current_record:
#                 flush_record()

#             # The current key for the record list is the last key added to the parent
#             # Get the parent dictionary from the stack
#             parent_dict = stack[-1][1]
#             # Find the last key added to that parent
#             if parent_dict:
#                  current_record_list_key = list(parent_dict.keys())[-1]
            
#             current_record[key_clean] = value.strip()
#             continue

#         # If we encounter a line that is NOT a 'Key: Value' pair,
#         # we must flush any pending record we were building.
#         flush_record()
#         current_record_list_key = None
        
#         # --- Main Indentation Logic ---
#         # Find the correct parent in the hierarchy by popping from the stack
#         while indent_level <= stack[-1][0]:
#             stack.pop()
        
#         parent_dict = stack[-1][1]

#         # Check if the stripped line is a key for a new dictionary or a simple value.
#         # If the parent dictionary's last key has a `None` value, this line is its value.
#         last_key_in_parent = list(parent_dict.keys())[-1] if parent_dict else None
        
#         if last_key_in_parent and parent_dict[last_key_in_parent] is None:
#              # This line is a value for the previous key
#              parent_dict[last_key_in_parent] = stripped_line
#         else:
#              # This line is a new key. Assign `None` as a placeholder for its value.
#              # If a more indented line follows, this will be replaced by a new dictionary.
#              # If not, the next line at the same/lesser indent will become its value.
#             if stripped_line in parent_dict: # Handle lists of items like in mainActionItems
#                 if not isinstance(parent_dict[stripped_line], list):
#                     parent_dict[stripped_line] = [parent_dict[stripped_line]]
#                 parent_dict[stripped_line].append(None) # Add placeholder for next value
#             else:
#                 parent_dict[stripped_line] = None
#                 # Push the new dictionary context onto the stack for potential children
#                 stack.append((indent_level, parent_dict))

#     # After the loop, do one final flush for any pending record
#     flush_record()
    
#     # --- Final Cleanup Pass ---
#     # This recursive function cleans up the dictionary structure.
#     def cleanup_final_dict(d):
#         if not isinstance(d, dict):
#             return d
        
#         cleaned_dict = {}
#         key_list = list(d.keys())
        
#         for i, key in enumerate(key_list):
#             value = d[key]
            
#             # This logic handles the key-on-one-line, value-on-the-next format
#             if isinstance(value, dict) and not value: # It's an empty dict placeholder
#                 # Check if the next key at this level looks like a value
#                 if i + 1 < len(key_list):
#                     next_key = key_list[i+1]
#                     # If the next "key" doesn't have children, it's actually the value for the current key
#                     if isinstance(d[next_key], dict) and not d[next_key]:
#                          cleaned_dict[key] = next_key
#                          continue
            
#             # If a key has a None value, it means no content was found for it.
#             if value is None:
#                 cleaned_dict[key] = "N/A"
#             # If it's a dictionary, recursively clean it
#             elif isinstance(value, dict):
#                 cleaned_dict[key] = cleanup_final_dict(value)
#             # Otherwise, just assign the value
#             else:
#                  cleaned_dict[key] = value

#         return cleaned_dict

#     # The cleanup logic is complex. Let's try to return the raw parsed data first.
#     # The primary parsing loop should be sufficient if the HTML converter is robust.
#     # The convert_dict_to_html function is designed to handle this structure.
#     return parsed_data


# def convert_dict_to_html(data_dict: dict) -> str:
#     """
#     Converts the parsed dictionary into clean, semantic, UNSYTYLED HTML.
#     Styling will be handled by a separate CSS file in the frontend.
#     """
#     if not data_dict or not isinstance(data_dict, dict):
#         return "<p>No summary data available to display.</p>"

#     # The main container now only has a class name for frontend CSS to target
#     html_parts = ['<div class="summary-container">']

#     def format_title(key_str: str) -> str:
#         # This helper is still useful
#         return re.sub(r'(?<!^)(?=[A-Z])', ' ', key_str).replace('_', ' ').title()

#     def render_list_of_dicts(items):
#         if not items: return "<p><em>N/A</em></p>"
#         if isinstance(items, dict): items = [items]
#         if not isinstance(items, list): return f"<p>{items}</p>"

#         item_html = '<ul class="item-list">'
#         for item in items:
#             if isinstance(item, dict):
#                 # Add a class name for styling
#                 item_html += '<li class="item-card">'
#                 for k, v in item.items():
#                     key_title = format_title(k)
#                     item_html += f'<div><strong>{key_title}:</strong> '
#                     if isinstance(v, list):
#                         item_html += "<ul>" + "".join(f"<li>{val}</li>" for val in v) + "</ul>"
#                     else:
#                         item_html += str(v)
#                     item_html += '</div>'
#                 item_html += '</li>'
#             else:
#                 item_html += f'<li>{item}</li>'
#         item_html += '</ul>'
#         return item_html

#     for major_key, minor_data in data_dict.items():
#         html_parts.append(f'<h4>{format_title(major_key)}</h4>')
#         if isinstance(minor_data, dict):
#             for minor_key, content in minor_data.items():
#                 html_parts.append(f'<h5>{format_title(minor_key)}</h5>')
#                 if not content and not isinstance(content, bool):
#                     html_parts.append('<p><em>N/A</em></p>')
#                 else:
#                     html_parts.append(render_list_of_dicts(content))
#         elif isinstance(minor_data, list):
#              html_parts.append(render_list_of_dicts(minor_data))
#         else:
#             html_parts.append(f'<p>{str(minor_data) if minor_data else "<em>N/A</em>"}</p>')

#     html_parts.append('</div>')
    
#     # Return ONLY the HTML structure, no <style> tag
#     return "".join(html_parts)




# Helper function to check for empty data
def is_section_empty(section_data):
    if isinstance(section_data, str):
        return section_data.strip().lower() in ['n/a', '']
    if isinstance(section_data, list):
        return not section_data
    if isinstance(section_data, dict):
        return all(is_section_empty(v) for v in section_data.values())
    return True

# In your Python script (e.g., app.py)
# This is the FINAL version of this function.

def generate_html_breakdown(parsed_dict: dict) -> dict:
    """
    Final version. Wraps each individual snippet in the breakdown with the
    container class to ensure consistent styling.
    """
    if not parsed_dict or not isinstance(parsed_dict, dict):
        return {"breakdown": {}, "full_html": "<p>No summary data available.</p>"}

    # --- Helper functions (no changes needed) ---
    def format_title(key_str: str) -> str:
        # ... (implementation from previous response is correct)
        return re.sub(r'(?<!^)(?=[A-Z])', ' ', key_str).replace('_', ' ').title()

    def render_list_of_dicts(items):
        # ... (implementation from previous response is correct)
        if not items: return "<p><em>N/A</em></p>"
        if isinstance(items, dict): items = [items]
        if not isinstance(items, list): return f"<p>{items}</p>"
        item_html_parts = ['<ul class="item-list">']
        for item in items:
            if isinstance(item, dict):
                item_html_parts.append('<li class="item-card">')
                for k, v in item.items():
                    item_html_parts.append(f'<div><strong>{format_title(k)}:</strong> ')
                    if isinstance(v, list):
                        item_html_parts.append("<ul>" + "".join(f"<li>{val}</li>" for val in v) + "</ul>")
                    else:
                        item_html_parts.append(str(v))
                    item_html_parts.append('</div>')
                item_html_parts.append('</li>')
            else:
                item_html_parts.append(f'<li>{item}</li>')
        item_html_parts.append('</ul>')
        return "".join(item_html_parts)

    def render_section_content(data):
        # ... (implementation from previous response is correct)
        content_parts = []
        if isinstance(data, dict):
            for minor_key, content in data.items():
                content_parts.append(f'<h5>{format_title(minor_key)}</h5>')
                if not content and not isinstance(content, bool):
                    content_parts.append('<p><em>N/A</em></p>')
                else:
                    content_parts.append(render_list_of_dicts(content))
        elif isinstance(data, list):
            content_parts.append(render_list_of_dicts(data))
        else:
            content_parts.append(f'<p>{str(data) if data else "<em>N/A</em>"}</p>')
        return "".join(content_parts)

    # --- Main Logic ---
    html_breakdown = {}
    full_html_parts = []
    for major_key, section_data in parsed_dict.items():
        if is_section_empty(section_data):
            continue
        
        content_html = render_section_content(section_data)
        
        # THE FIX FOR ISSUE #3 IS HERE:
        # Wrap each individual snippet in the container div so CSS styles apply correctly.
        html_breakdown[major_key] = f'<div class="summary-container">{content_html}</div>'
        
        full_html_parts.append(f"<h4>{format_title(major_key)}</h4>{content_html}")

    full_html_with_styles = f'<div class="summary-container">{"".join(full_html_parts)}</div>'

    return {
        "breakdown": html_breakdown,
        "full_html": full_html_with_styles
    }


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


# @app.route('/api/emails/<email_id>/summarize', methods=['POST'])
# @authenticate_jwt
# def summarize_email(email_id):
#     """
#     This is the new, unified summarization endpoint. It handles multiple AI
#     response formats and uses a single, consistent pipeline to generate the final HTML.
#     """
#     user_id = request.user.get('id')
#     logger.info(f"Received request to summarize email ID: {email_id} for user: {user_id}")
    
#     if not GEMINI_API_KEY:
#         logger.error("Gemini API is not configured")
#         return jsonify({'message': 'AI service is not properly configured'}), 500

#     try:
#         # STEP 1: FETCH THE EMAIL DATA (Your existing code is good)
#         logger.info(f"Fetching email content for ID: {email_id}")
#         headers = {'Authorization': request.headers.get('Authorization')}
#         response = requests.get(
#             f"{EMAIL_SERVICE_URL}/api/emails/{email_id}",
#             headers=headers,
#             timeout=30
#         )
#         response.raise_for_status() # This is a cleaner way to handle bad responses
#         email_data = response.json()
        
#         # This part of your code is also correct
#         processed_data = process_email_with_images(email_data)
#         body = processed_data.get('emailBody', '')
#         image_content = processed_data.get('imageContent', [])
        
#         if not body and not image_content:
#             logger.error(f"No content found for email ID: {email_id}")
#             return jsonify({'message': 'Could not find text content in this email to summarize'}), 400
        
#         clean_body = re.sub(r'<[^>]*>', '', body)
#         combined_content = clean_body + "\n".join(
#             [f"\n--- IMAGE: {img['imageName']} ---\n{img['extractedText']}" for img in image_content]
#         )
#         structured_input = {"emailBody": combined_content, "imageContent": [], "attachmentContent": []}

#         # STEP 2: CALL THE GEMINI AI (Your existing code is good)
#         prompt = f"{prompt_text}:\n\n{json.dumps(structured_input, indent=2)}"
#         gemini_payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}]}
#         logger.info(f"Sending request to Gemini API for email summarization.")
        
#         api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
#         gemini_response = requests.post(api_url, headers={'Content-Type': 'application/json'}, json=gemini_payload, timeout=60)
        
#         if not gemini_response.ok:
#             logger.error(f"Gemini API request failed: {gemini_response.text}")
#             return jsonify({'message': 'Failed to generate email summary.'}), 500
        
#         result = gemini_response.json()
        
#         if not (result.get('candidates') and len(result['candidates']) > 0):
#              logger.error("Invalid response format from Gemini API")
#              return jsonify({'message': 'Invalid response format from Gemini API'}), 500
        
#         raw_summary = result['candidates'][0]['content']['parts'][0]['text']
#         logger.info("Raw summary received from Gemini.")


#         parsed_dict = None

#         # Step 2a: Clean the raw AI response to remove markdown fences
#         clean_text = raw_summary.strip()
#         if clean_text.startswith('```json'):
#             clean_text = clean_text[7:].strip()
#         if clean_text.endswith('```'):
#             clean_text = clean_text[:-3].strip()

#         # Step 2b: Try parsing as perfect JSON first (best case)
#         try:
#             logger.info("Attempting to parse response as pure JSON.")
#             parsed_dict = json.loads(clean_text)
#             logger.info("Successfully parsed as pure JSON.")
#         except json.JSONDecodeError:
#             # Step 2c: If JSON fails, fall back to our robust text parser
#             logger.warning("JSON parsing failed. Falling back to custom text parser.")
#             parsed_dict = parse_summary_to_dict(raw_summary, ALL_SCHEMA_KEYS)
#             logger.info("Successfully parsed summary from text block.")
        
#         if not parsed_dict:
#              logger.error("Could not produce a valid dictionary from the AI response.")
#              return jsonify({'summary': '<p>Error: The AI response could not be understood.</p>'}), 500
        
#         logger.info("Converting final dictionary to HTML.")

#         # Call the new function to get the HTML breakdown
#         html_payload = generate_html_breakdown(parsed_dict)
        
#         # Return the new JSON structure to the frontend
#         return jsonify({
#             'summary_html_breakdown': html_payload['breakdown'],
#             'summary_html_full': html_payload['full_html'],
#             'summary_json': parsed_dict
#         }), 200

#     except requests.RequestException as e:
#         logger.error(f"Error communicating with a service: {str(e)}")
#         return jsonify({'message': 'Error communicating with a service.'}), 500
#     except Exception as e:
#         logger.error(f"An unexpected error occurred in summarize_email: {str(e)}")
#         return jsonify({'message': 'An internal server error occurred.'}), 500

# In your Python script (e.g., app.py)
# This is the new, simpler, and final version of the function.

@app.route('/api/emails/<email_id>/summarize', methods=['POST'])
@authenticate_jwt
def summarize_email(email_id):
    user_id = request.user.get('id')
    logger.info(f"Received request to summarize email ID: {email_id} for user: {user_id}")
    
    if not GEMINI_API_KEY:
        return jsonify({'message': 'AI service is not properly configured'}), 500

    try:
        # --- Step 1: Fetch and Prepare Email Content (No changes here) ---
        headers = {'Authorization': request.headers.get('Authorization')}
        response = requests.get(f"{EMAIL_SERVICE_URL}/api/emails/{email_id}", headers=headers, timeout=30)
        response.raise_for_status()
        email_data = response.json()
        
        processed_data = process_email_with_images(email_data)
        body = processed_data.get('emailBody', '')
        image_content = processed_data.get('imageContent', [])
        
        if not body and not image_content:
            return jsonify({'message': 'Could not find text content to summarize'}), 400
        
        clean_body = re.sub(r'<[^>]*>', '', body)
        combined_content = clean_body + "\n".join(
            [f"\n--- IMAGE: {img['imageName']} ---\n{img['extractedText']}" for img in image_content]
        )
        structured_input = {"emailBody": combined_content}
        prompt = f"{prompt_text}:\n\n{json.dumps(structured_input, indent=2)}"
        chat_history = [{"role": "user", "parts": [{"text": prompt}]}]

        # --- Step 2: Call the Gemini API with JSON Mode Enabled ---
        
        # THIS IS THE NEW, CRUCIAL PART. We tell the AI we want JSON back.
        gemini_payload = {
            "contents": chat_history,
            "generationConfig": {
                "response_mime_type": "application/json"
            }
        }
        
        logger.info("Sending request to Gemini API with JSON response type.")
        # api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={GEMINI_API_KEY}"
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
        gemini_response = requests.post(api_url, headers={'Content-Type': 'application/json'}, json=gemini_payload, timeout=60)
        gemini_response.raise_for_status()
        
        result = gemini_response.json()
        
        if not (result.get('candidates') and len(result['candidates']) > 0):
             return jsonify({'message': 'Invalid response format from Gemini API'}), 500
        
        # The AI's response is now a guaranteed JSON string
        raw_json_string = result['candidates'][0]['content']['parts'][0]['text']
        
        # --- Step 3: Parse the Guaranteed JSON and Convert to HTML ---

        # We can now use a simple, reliable json.loads(). No more custom parser needed!
        parsed_dict = json.loads(raw_json_string)
        logger.info("Successfully parsed guaranteed JSON from AI response.")
        
        
        # Our existing HTML generator will now work perfectly
        html_payload = generate_html_breakdown(parsed_dict)
        
        logger.info(f"Parsed dictionary: {parsed_dict}")
        # logger.info(f"HTML payload: {html_payload}")
        return jsonify({
            'summary_html_breakdown': html_payload['breakdown'],
            'summary_html_full': html_payload['full_html'],
            'summary_json': parsed_dict
        }), 200

    except requests.RequestException as e:
        logger.error(f"Error communicating with a service: {str(e)}")
        return jsonify({'message': 'Error communicating with a service.'}), 500
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse the JSON response from the AI: {str(e)}")
        return jsonify({'message': 'AI returned invalid JSON.'}), 500
    except Exception as e:
        logger.error(f"An unexpected error occurred in summarize_email: {str(e)}")
        return jsonify({'message': 'An internal server error occurred.'}), 500


@app.route('/api/emails/<email_id>/summarize-json', methods=['POST'])
@authenticate_jwt
def summarize_email_json(email_id):
    """Generate AI-powered summary of email content and return structured JSON"""
    user_id = request.user.get('id')
    logger.info(f"Received request to summarize email (JSON format) ID: {email_id} for user: {user_id}")
    
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
        
        # Process email with OCR to extract text from images
        processed_data = process_email_with_images(email_data)
        
        body = processed_data.get('emailBody', '')
        image_content = processed_data.get('imageContent', [])
        
        if not body and not image_content:
            logger.error(f"No content found for email ID: {email_id}")
            return jsonify({'message': 'Could not find text content in this email to summarize'}), 400
        
        # Clean HTML tags and prepare for AI summarization
        import re
        clean_body = re.sub(r'<[^>]*>', '', body)
        
        # Create structured input for AI as expected by the prompt
        import json
        structured_input = {
            "emailBody": clean_body,
            "imageContent": image_content,
            "attachmentContent": []  # TODO: Add attachment processing
        }
        
        # Create the full prompt with structured data - emphasize JSON output
        json_prompt = f"""
        {prompt_text}
        
        IMPORTANT: You MUST respond with ONLY valid JSON that matches the schema exactly. 
        Do not include any markdown formatting, explanations, or text outside the JSON.
        Start your response directly with {{ and end with }}.
        
        Email data to analyze:
        {json.dumps(structured_input, indent=2)}
        """
        
        # Create chat history format for Gemini API
        chat_history = [{"role": "user", "parts": [{"text": json_prompt}]}]
        gemini_payload = {"contents": chat_history}
        
        logger.info(f"Sending email content to Gemini 2.5 Flash API for JSON summarization")
        
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
            logger.info(f"Raw JSON summary received from Gemini for email: {email_id}")
            
            try:
                # Clean the response - remove any markdown formatting or extra text
                cleaned_response = raw_summary.strip()
                
                # Try to extract JSON from the response
                json_start = cleaned_response.find('{')
                json_end = cleaned_response.rfind('}') + 1
                
                if json_start >= 0 and json_end > json_start:
                    json_str = cleaned_response[json_start:json_end]
                    
                    try:
                        parsed_json = json.loads(json_str)
                        logger.info(f"Successfully parsed JSON response for email: {email_id}")
                        
                        # Convert JSON to HTML using our new function
                        html_summary = convert_json_to_html(parsed_json)
                        
                        return jsonify({
                            'summary': html_summary,
                            'summary_json': parsed_json,
                            'summary_raw': raw_summary,
                            'format': 'json',
                            'success': True
                        }), 200
                        
                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to parse JSON response for email {email_id}: {str(e)}")
                        return jsonify({
                            'message': 'AI returned invalid JSON format',
                            'error': str(e),
                            'raw_response': raw_summary[:500] + '...' if len(raw_summary) > 500 else raw_summary
                        }), 422
                
                else:
                    logger.error(f"No JSON found in response for email {email_id}")
                    return jsonify({
                        'message': 'AI did not return JSON format',
                        'raw_response': raw_summary[:500] + '...' if len(raw_summary) > 500 else raw_summary
                    }), 422
                
            except Exception as e:
                logger.error(f"Error processing JSON response for email {email_id}: {str(e)}")
                return jsonify({
                    'message': 'Error processing AI response',
                    'error': str(e)
                }), 500
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

@app.route('/api/debug/check-email-images', methods=['POST'])
@authenticate_jwt
def debug_check_email_images():
    """Debug endpoint to check what images are detected in email content"""
    user_id = request.user.get('id')
    logger.info(f"Debug: Checking email images for user: {user_id}")
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'No JSON data provided'}), 400
        
        # You can send either email_id or email_data directly
        email_id = data.get('emailId')
        email_data = data.get('emailData')
        
        if email_id:
            # Fetch email content from email service
            headers = {'Authorization': request.headers.get('Authorization')}
            response = requests.get(
                f"{EMAIL_SERVICE_URL}/api/emails/{email_id}",
                headers=headers,
                timeout=30
            )
            
            if not response.ok:
                return jsonify({'message': 'Failed to fetch email content'}), response.status_code
            
            email_data = response.json()
        
        if not email_data:
            return jsonify({'message': 'No email data provided'}), 400
        
        # Process the email to detect images
        processed_data = process_email_with_images(email_data)
        
        # Create detailed debug information
        debug_info = {
            'emailBodyLength': len(email_data.get('body', '')),
            'hasEmailBody': bool(email_data.get('body', '')),
            'imagesFound': len(processed_data['imageContent']),
            'imageDetails': processed_data['imageContent'],
            'hasImages': processed_data['hasImages'],
            'imageReferences': processed_data['imageReferences'],
            'imageIndicators': processed_data['imageIndicators'],
            'attachmentsProvided': len(email_data.get('attachments', [])),
            'emailBodySample': email_data.get('body', '')[:500] + '...' if len(email_data.get('body', '')) > 500 else email_data.get('body', ''),
            'metadata': {
                'processedAt': datetime.now().isoformat(),
                'userId': user_id
            }
        }
        
        # Check for specific patterns in email body
        email_body = email_data.get('body', '')
        if email_body:
            # Find all image URLs
            all_img_urls = re.findall(r'<img[^>]+src="([^"]+)"[^>]*>', email_body, re.IGNORECASE)
            base64_urls = [url for url in all_img_urls if url.startswith('data:image/')]
            external_urls = [url for url in all_img_urls if url.startswith(('http:', 'https:'))]
            other_urls = [url for url in all_img_urls if not url.startswith(('data:', 'http:', 'https:'))]
            
            debug_info['patterns'] = {
                'hasImgTags': '<img' in email_body.lower(),
                'hasBase64Images': 'data:image/' in email_body,
                'hasCidReferences': 'cid:' in email_body,
                'hasAttachmentRefs': 'attachment:' in email_body,
                'imgTagCount': len(re.findall(r'<img[^>]*>', email_body, re.IGNORECASE)),
                'totalImageUrls': len(all_img_urls),
                'base64ImageUrls': len(base64_urls),
                'externalImageUrls': len(external_urls),
                'otherImageUrls': len(other_urls),
                'externalUrls': external_urls[:5],  # Show first 5 URLs for debugging
                'otherUrls': other_urls[:5]
            }
        
        logger.info(f"Debug: Email image check complete for user {user_id}")
        return jsonify(debug_info)
        
    except Exception as e:
        logger.error(f"Debug: Error checking email images for user {user_id}: {str(e)}")
        return jsonify({'message': f'Failed to check email images: {str(e)}'}), 500

@app.route('/api/ocr/process-image', methods=['POST'])
@authenticate_jwt
def process_image_ocr():
    """Extract text from a base64 encoded image"""
    user_id = request.user.get('id')
    logger.info(f"Received request to process image with OCR for user: {user_id}")
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'No JSON data provided'}), 400
        
        image_base64 = data.get('imageBase64')
        image_name = data.get('imageName', 'unknown_image')
        
        if not image_base64:
            return jsonify({'message': 'imageBase64 field is required'}), 400
        
        # Process the image with OCR
        ocr_result = extract_text_from_image_base64(image_base64, image_name)
        
        response_data = {
            'imageName': image_name,
            'extractedText': ocr_result['text'],
            'confidence': ocr_result['confidence'],
            'success': ocr_result['text'] != '',
            'metadata': {
                'processedAt': datetime.now().isoformat(),
                'userId': user_id,
                'textLength': len(ocr_result['text'])
            }
        }
        
        if 'error' in ocr_result:
            response_data['error'] = ocr_result['error']
        
        logger.info(f"Successfully processed image OCR for user {user_id}. Text length: {len(ocr_result['text'])}")
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error processing image OCR for user {user_id}: {str(e)}")
        return jsonify({'message': f'Failed to process image OCR: {str(e)}'}), 500

@app.route('/api/ocr/process-url', methods=['POST'])
@authenticate_jwt
def process_image_url_ocr():
    """Extract text from an image URL"""
    user_id = request.user.get('id')
    logger.info(f"Received request to process image URL with OCR for user: {user_id}")
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'No JSON data provided'}), 400
        
        image_url = data.get('imageUrl')
        image_name = data.get('imageName', 'url_image')
        
        if not image_url:
            return jsonify({'message': 'imageUrl field is required'}), 400
        
        # Process the image URL with OCR
        ocr_result = extract_text_from_image_url(image_url, image_name)
        
        response_data = {
            'imageName': image_name,
            'imageUrl': image_url,
            'extractedText': ocr_result['text'],
            'confidence': ocr_result['confidence'],
            'success': ocr_result['text'] != '',
            'metadata': {
                'processedAt': datetime.now().isoformat(),
                'userId': user_id,
                'textLength': len(ocr_result['text'])
            }
        }
        
        if 'error' in ocr_result:
            response_data['error'] = ocr_result['error']
        
        logger.info(f"Successfully processed image URL OCR for user {user_id}. Text length: {len(ocr_result['text'])}")
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error processing image URL OCR for user {user_id}: {str(e)}")
        return jsonify({'message': f'Failed to process image URL OCR: {str(e)}'}), 500

@app.route('/api/test/json-to-html', methods=['POST'])
@authenticate_jwt
def test_json_to_html():
    """Test endpoint to convert JSON to HTML format"""
    user_id = request.user.get('id')
    logger.info(f"Test JSON-to-HTML conversion for user: {user_id}")
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'No JSON data provided'}), 400
        
        test_json = data.get('json_data')
        if not test_json:
            return jsonify({'message': 'json_data field is required'}), 400
        
        # Convert JSON to HTML using our function
        html_result = convert_json_to_html(test_json)
        
        return jsonify({
            'html_output': html_result,
            'input_json': test_json,
            'success': True,
            'debug_info': {
                'top_level_keys': list(test_json.keys()) if isinstance(test_json, dict) else 'Not a dict',
                'executive_summary_keys': list(test_json.get('executiveSummary', {}).keys()) if isinstance(test_json.get('executiveSummary'), dict) else 'Not found or not a dict',
                'executive_summary_spaced_keys': list(test_json.get('executive Summary', {}).keys()) if isinstance(test_json.get('executive Summary'), dict) else 'Not found or not a dict'
            },
            'metadata': {
                'processedAt': datetime.now().isoformat(),
                'userId': user_id
            }
        })
        
    except Exception as e:
        logger.error(f"Error in JSON-to-HTML test for user {user_id}: {str(e)}")
        return jsonify({'message': f'Failed to convert JSON to HTML: {str(e)}'}), 500

@app.route('/api/test/sample-json-html', methods=['GET'])
@authenticate_jwt
def test_sample_json_html():
    """Test endpoint with a sample JSON to verify HTML conversion"""
    user_id = request.user.get('id')
    logger.info(f"Testing sample JSON-to-HTML conversion for user: {user_id}")
    
    # Sample JSON matching your schema
    sample_json = {
        "executive Summary": {
            "key Message": "The email promotes Simplilearn's 'Tech Master of Master's Program' as a solution for tech professionals.",
            "main Action Items": [
                "Check out the course now",
                "Enroll in the Tech Master of Master's Program"
            ],
            "decisions": ["N/A"]
        },
        "action Items": {
            "tasks": [
                {
                    "description": "Explore and consider enrolling in the Tech Master of Master's Program.",
                    "responsible": "Kuppuram",
                    "deadline": "N/A",
                    "status": "N/A"
                }
            ],
            "next Steps": ["Check out the course now"],
            "required Actions": ["Recipient to explore/enroll in the Simplilearn Tech Master of Master's Program."]
        },
        "marketing Impact": {
            "brand Implications": ["Simplilearn Solutions Pvt. Ltd. is offering a comprehensive Tech Master of Master's Program."],
            "campaign Effects": ["The email aims to drive enrollment in the 'Tech Master of Master's Program'."],
            "market Positioning": ["Positions the program as essential for staying ahead."]
        }
    }
    
    try:
        # Convert to HTML
        html_result = convert_json_to_html(sample_json)
        
        return jsonify({
            'html_output': html_result,
            'sample_json': sample_json,
            'success': True,
            'message': 'Sample JSON successfully converted to HTML'
        })
        
    except Exception as e:
        logger.error(f"Error in sample JSON-to-HTML test: {str(e)}")
        return jsonify({'message': f'Failed to convert sample JSON: {str(e)}'}), 500

@app.route('/api/daily-digest/generate', methods=['POST'])
@authenticate_jwt
def generate_daily_digest():
    """Generate daily digest from consolidated email summaries"""
    user_id = request.user.get('id')
    logger.info(f"Received request to generate daily digest for user: {user_id}")
    
    if not GEMINI_API_KEY:
        return jsonify({'message': 'AI service is not properly configured'}), 500
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'message': 'No JSON data provided'}), 400
        
        summaries = data.get('summaries', [])
        target_date = data.get('date', datetime.now().strftime('%Y-%m-%d'))
        provider_counts = data.get('providerCounts', {})
        
        if not summaries:
            return jsonify({'message': 'No email summaries provided'}), 400
        
        logger.info(f"Processing {len(summaries)} email summaries for daily digest on {target_date}")
        logger.info(f"Provider breakdown: {provider_counts}")
        
        # Create consolidated summary data with provider information
        consolidated_data = {
            "date": target_date,
            "totalEmails": len(summaries),
            "providerBreakdown": provider_counts,
            "emailSummaries": summaries
        }
        
        # Create prompt for daily digest generation
        digest_prompt = f"""
        You are an executive assistant creating a comprehensive daily email digest. 
        Analyze the following email summaries from {target_date} and create a structured daily digest.
        
        Note: This digest includes emails from multiple providers (Gmail: {provider_counts.get('gmail', 0)}, Outlook: {provider_counts.get('outlook', 0)}, Other: {provider_counts.get('unknown', 0)}).
        
        Your task is to:
        1. Provide an executive overview of the day's email activity across all connected accounts
        2. Highlight the most critical action items and decisions needed
        3. Summarize key financial impacts and business implications
        4. Identify urgent matters requiring immediate attention
        5. Group similar topics together for easier consumption
        6. Create a concise audio script for the digest
        7. Include provider-specific insights if relevant (e.g., work emails from Outlook vs personal from Gmail)
        
        Please respond with a JSON object following this structure:
        {{
            "date": "{target_date}",
            "executiveSummary": {{
                "totalEmails": {len(summaries)},
                "providerBreakdown": {provider_counts},
                "keyHighlights": ["highlight1", "highlight2", "highlight3"],
                "criticalActions": ["action1", "action2"],
                "urgentMatters": ["urgent1", "urgent2"]
            }},
            "categoryBreakdown": {{
                "Financial / Bills": {{"count": 0, "keyPoints": []}},
                "Official/Work": {{"count": 0, "keyPoints": []}},
                "Transactional": {{"count": 0, "keyPoints": []}},
                "Security Alert": {{"count": 0, "keyPoints": []}},
                "Other": {{"count": 0, "keyPoints": []}}
            }},
            "actionItems": {{
                "highPriority": [],
                "mediumPriority": [],
                "lowPriority": []
            }},
            "financialSummary": {{
                "totalFinancialEmails": 0,
                "keyFinancialItems": [],
                "urgentPayments": []
            }},
            "audioScript": "A concise summary suitable for audio playback in under 2 minutes"
        }}
        
        Email summaries to analyze:
        {json.dumps(consolidated_data, indent=2)}
        """
        
        # Call Gemini API with JSON mode
        gemini_payload = {
            "contents": [{"role": "user", "parts": [{"text": digest_prompt}]}],
            "generationConfig": {
                "response_mime_type": "application/json"
            }
        }
        
        logger.info("Sending daily digest request to Gemini API")
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
        gemini_response = requests.post(api_url, headers={'Content-Type': 'application/json'}, json=gemini_payload, timeout=60)
        gemini_response.raise_for_status()
        
        result = gemini_response.json()
        
        if not (result.get('candidates') and len(result['candidates']) > 0):
            return jsonify({'message': 'Invalid response format from Gemini API'}), 500
        
        # Parse the JSON response
        daily_digest_json = json.loads(result['candidates'][0]['content']['parts'][0]['text'])
        
        # Convert to HTML for display
        html_digest = generate_html_breakdown(daily_digest_json)
        
        logger.info(f"Successfully generated daily digest for user {user_id} on {target_date}")
        
        return jsonify({
            'dailyDigest': {
                'date': target_date,
                'digestJson': daily_digest_json,
                'digestHtml': html_digest['full_html'],
                'digestBreakdown': html_digest['breakdown'],
                'audioScript': daily_digest_json.get('audioScript', ''),
                'totalEmails': len(summaries),
                'generatedAt': datetime.now().isoformat()
            },
            'success': True
        }), 200
        
    except requests.RequestException as e:
        logger.error(f"Error communicating with Gemini API: {str(e)}")
        return jsonify({'message': 'Error generating daily digest'}), 500
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON response from AI: {str(e)}")
        return jsonify({'message': 'AI returned invalid JSON for daily digest'}), 500
    except Exception as e:
        logger.error(f"Error generating daily digest for user {user_id}: {str(e)}")
        return jsonify({'message': 'Failed to generate daily digest'}), 500

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