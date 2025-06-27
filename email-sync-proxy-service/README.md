# Email Sync Proxy Service

A TypeScript-based microservice for handling Gmail integration, email fetching, and AI-powered email summarization using Drizzle ORM.

## Features

- ✅ Gmail inbox fetching via Google APIs
- ✅ Individual email content retrieval
- ✅ AI-powered email summarization with Gemini API
- ✅ JWT authentication for all endpoints
- ✅ PostgreSQL database with Drizzle ORM
- ✅ TypeScript for type safety
- ✅ Health check endpoint

## API Endpoints

### Email Operations

#### GET `/emails/inbox`
Fetch Gmail inbox messages (requires JWT authentication).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "messages": [
    {
      "id": "email_id",
      "snippet": "Email preview text...",
      "subject": "Email Subject",
      "from": "sender@example.com",
      "date": "Wed, 23 Jun 2025 10:30:00 +0000"
    }
  ]
}
```

#### GET `/emails/:emailId`
Get specific email content by ID (requires JWT authentication).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "id": "email_id",
  "snippet": "Email preview...",
  "subject": "Email Subject",
  "from": "sender@example.com",
  "date": "Wed, 23 Jun 2025 10:30:00 +0000",
  "body": "Full email content..."
}
```

#### POST `/emails/:emailId/summarize`
Generate AI summary of email content (requires JWT authentication).

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

### Health Check

#### GET `/emails/health`
Check service health status (requires JWT authentication for security).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "status": "healthy",
  "service": "email-sync-proxy-service",
  "timestamp": "2025-06-23T17:42:43.981Z"
}
```

## Environment Variables

Create a `.env` file in the parent directory with:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/database"

# JWT
JWT_SECRET="your-jwt-secret-key"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Gemini AI
GEMINI_API_KEY="your-gemini-api-key"

# Service Port
EMAIL_SERVICE_PORT=3003
```

## Prerequisites

1. **Google OAuth Setup**: Configure Google Cloud Console with OAuth2 credentials
2. **Gemini API Key**: Get API key from Google AI Studio
3. **PostgreSQL Database**: Running database with users table
4. **User Management Service**: Must be running for JWT token generation

## Development

### Install Dependencies
```bash
npm install
```

### Run in Development Mode
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

### Start Production Server
```bash
npm run start:prod
```

## Database Integration

The service connects to the same PostgreSQL database as the User Management Service to fetch Google refresh tokens:

```sql
-- Required table structure
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  google_refresh_token VARCHAR(500), -- Used by this service
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

## Authentication Flow

1. User authenticates with User Management Service
2. User receives JWT token
3. User connects Google account (stores refresh token)
4. Email service uses JWT + stored refresh token to access Gmail

## Error Handling

- **401 Unauthorized**: No JWT token provided
- **403 Forbidden**: Invalid or expired JWT token
- **400 Bad Request**: Missing email content for summarization
- **500 Internal Server Error**: Gmail API errors, database errors, or Gemini API failures

## Technology Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL with Drizzle ORM
- **Authentication:** JWT verification
- **External APIs:** Gmail API, Gemini AI API
- **Build Tool:** TypeScript Compiler (tsc)

## Security Features

- JWT authentication required for all endpoints
- Secure Google OAuth2 token management
- Environment variable protection for sensitive data
- Input validation and error handling 