# User Management Service

A TypeScript-based microservice for handling user authentication, registration, and Google OAuth integration using Drizzle ORM.

## Features

- ✅ User registration with email/password
- ✅ User login with JWT token generation
- ✅ Google OAuth2 integration
- ✅ Password hashing with bcrypt
- ✅ PostgreSQL database with Drizzle ORM
- ✅ TypeScript for type safety
- ✅ Health check endpoint

## API Endpoints

### Authentication

#### POST `/auth/signup`
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "token": "jwt_token"
}
```

#### POST `/auth/login`
Login with existing credentials.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "token": "jwt_token"
}
```

#### POST `/auth/google/callback`
Connect Google account (requires JWT authentication).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "code": "google_auth_code"
}
```

### Health Check

#### GET `/health`
Check service health status.

**Response:**
```json
{
  "status": "healthy",
  "service": "user-management-service",
  "timestamp": "2025-06-23T15:01:05.782Z"
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

# Service Port
USER_SERVICE_PORT=3002
```

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

## Database Schema

The service uses the following PostgreSQL table:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  google_refresh_token VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

## Technology Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL with Drizzle ORM
- **Authentication:** JWT + bcrypt
- **OAuth:** Google OAuth2
- **Build Tool:** TypeScript Compiler (tsc) 