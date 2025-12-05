# AI Services Microservice

A Python Flask-based microservice for AI-powered operations, primarily focused on email summarization using Google's Gemini API.

## Features

- ✅ Email summarization using Gemini AI
- ✅ JWT authentication
- ✅ RESTful API endpoints
- ✅ Comprehensive logging
- ✅ Health check endpoint
- ✅ Docker support
- ✅ General AI content generation

## API Endpoints

### AI Operations

#### POST `/api/emails/<email_id>/summarize`
Generate AI-powered summary of email content (requires JWT authentication).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "summary": "AI-generated summary of the email content..."
}
```

#### POST `/api/ai/generate-content`
General AI content generation endpoint (requires JWT authentication).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "prompt": "Your prompt here..."
}
```

**Response:**
```json
{
  "content": "AI-generated content..."
}
```

### Health Check

#### GET `/health`
Check service health status (requires JWT authentication).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "status": "healthy",
  "service": "ai-services",
  "timestamp": "2025-01-20T10:30:00.000Z",
  "gemini_configured": true
}
```

## Environment Variables

- `AI_SERVICE_PORT`: Port for the AI service (default: 3004)
- `JWT_SECRET`: Secret key for JWT token verification
- `GEMINI_API_KEY`: Google Gemini API key for AI operations
- `EMAIL_SERVICE_PORT`: Port of the email service (default: 3003)

## Installation & Setup

### Development

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Set up environment variables:
```bash
export AI_SERVICE_PORT=3004
export JWT_SECRET=your-secret-key
export GEMINI_API_KEY=your-gemini-api-key
export EMAIL_SERVICE_PORT=3003
```

3. Run the service:
```bash
python app.py
```

### Docker

```bash
docker build -t ai-services .
docker run -p 3004:3004 --env-file .env ai-services
```

## Architecture

The AI Services microservice follows a clean architecture pattern:

- **Flask Application**: Main web framework
- **JWT Authentication**: Secure endpoint access
- **Gemini AI Integration**: Google's generative AI for content creation
- **Service Communication**: RESTful communication with email service
- **Comprehensive Logging**: Detailed request/response logging

## Dependencies

- **Flask**: Web framework
- **Flask-CORS**: Cross-origin resource sharing
- **PyJWT**: JWT token handling
- **google-generativeai**: Google Gemini AI client
- **python-dotenv**: Environment variable management
- **requests**: HTTP client for service communication
- **gunicorn**: Production WSGI server 