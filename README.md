# LMAA Backend

A microservices-based backend architecture for the LMAA (Let Me Ask AI) email management application.

## Architecture Overview

The backend consists of the following microservices:

### 🌐 API Gateway (`api-gateway`)
- **Port**: 3001
- **Technology**: Node.js/TypeScript, Express
- **Purpose**: Central entry point that routes requests to appropriate microservices
- **Routes**:
  - `/api/auth/*` → User Management Service
  - `/api/emails/*` → Email Sync Proxy Service (except summarization)
  - `/api/emails/*/summarize` → AI Services
  - `/api/ai/*` → AI Services

### 👤 User Management Service (`user-management-service`)
- **Port**: 3002
- **Technology**: Node.js/TypeScript, Express
- **Purpose**: Handles user authentication, registration, and profile management
- **Features**:
  - User registration and login
  - JWT token management
  - Google OAuth integration

### 📧 Email Sync Proxy Service (`email-sync-proxy-service`)
- **Port**: 3003
- **Technology**: Node.js/TypeScript, Express
- **Purpose**: Gmail integration and email content management
- **Features**:
  - Gmail inbox fetching
  - Individual email content retrieval
  - Google API integration
  - JWT authentication

### 🤖 AI Services (`ai-services`)
- **Port**: 3004
- **Technology**: Python, Flask
- **Purpose**: AI-powered operations using Google Gemini API
- **Features**:
  - Email content summarization
  - General AI content generation
  - Gemini AI integration
  - JWT authentication

### 🗄️ Shared Components (`shared`)
- **Purpose**: Common utilities and database configurations
- **Features**:
  - Database connection management (Drizzle ORM)
  - Shared TypeScript interfaces
  - Common utility functions

## Environment Variables

The following environment variables are required:

```env
# Service Ports
API_GATEWAY_PORT=3001
USER_SERVICE_PORT=3002
EMAIL_SERVICE_PORT=3003
AI_SERVICE_PORT=3004

# Authentication
JWT_SECRET=your-secret-key

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/lmaa

# Google APIs
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GEMINI_API_KEY=your-gemini-api-key
```

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.11+
- PostgreSQL database
- Google Cloud Console project with Gmail API enabled
- Google AI Studio account for Gemini API

### Installation

1. Install Node.js dependencies:
```bash
npm install
```

2. Install Python dependencies for AI services:
```bash
cd ai-services
pip install -r requirements.txt
cd ..
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Set up the database:
```bash
npx drizzle-kit push
```

### Running the Services

#### Development Mode

Start all services individually:

```bash
# Terminal 1 - API Gateway
cd api-gateway
npm run dev

# Terminal 2 - User Management Service
cd user-management-service
npm run dev

# Terminal 3 - Email Sync Proxy Service
cd email-sync-proxy-service
npm run dev

# Terminal 4 - AI Services
cd ai-services
python app.py
```

#### Production Mode

```bash
# Build and start all Node.js services
npm run build
npm start

# Start AI services
cd ai-services
gunicorn --bind 0.0.0.0:3004 --workers 4 app:app
```

### Docker Support

Each service includes Docker support:

```bash
# Build AI services container
cd ai-services
docker build -t ai-services .
docker run -p 3004:3004 --env-file .env ai-services
```

## API Documentation

### Authentication Flow
1. User authenticates via User Management Service
2. JWT token is issued
3. All subsequent requests include the JWT token
4. API Gateway validates and forwards requests

### Service Communication
- API Gateway → All services (HTTP proxy)
- AI Services → Email Service (HTTP requests)
- All services use JWT for authentication

## Technology Stack

- **Backend Framework**: Node.js/Express, Python/Flask
- **Authentication**: JWT tokens
- **Database**: PostgreSQL with Drizzle ORM
- **AI/ML**: Google Gemini API
- **Email Integration**: Gmail API
- **Deployment**: Docker containers
- **API Documentation**: RESTful endpoints

## Health Checks

Each service provides a health check endpoint:
- API Gateway: `GET /health`
- User Service: `GET /health`
- Email Service: `GET /emails/health`
- AI Services: `GET /health`
