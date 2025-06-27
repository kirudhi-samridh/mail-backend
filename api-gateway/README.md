# API Gateway

A TypeScript-based API Gateway for microservices routing and load balancing with Drizzle ORM integration.

## Features

- ✅ Intelligent request routing to microservices
- ✅ Path rewriting and URL transformation
- ✅ CORS support for cross-origin requests
- ✅ Comprehensive logging and monitoring
- ✅ Error handling and proxy error management
- ✅ Health check endpoint
- ✅ TypeScript for type safety
- ✅ PostgreSQL database with Drizzle ORM

## Architecture

The API Gateway acts as a single entry point for all client requests, routing them to appropriate microservices:

```
Frontend (localhost:3000)
    ↓
API Gateway (localhost:3001)
    ├── /api/auth/* → User Management Service (localhost:3002)
    └── /api/emails/* → Email Sync Service (localhost:3003)
```

## Environment Variables

Create a `.env` file in the parent directory with:

```env
# API Gateway
API_GATEWAY_PORT=3001

# Service URLs
USER_SERVICE_URL="http://localhost:3002"
EMAIL_SERVICE_URL="http://localhost:3003"

# Database
DATABASE_URL="postgresql://username:password@localhost:5432/database"
```

## Development

### Install Dependencies
```bash
npm install
```

### Run in Development Mode
```bash
# Normal development (with file watching)
npm run dev

# Fast development (optimized watching)
npm run dev:fast

# Turbo mode (fastest startup)
npm run dev:turbo
```

### Build for Production
```bash
npm run build
```

### Start Production Server
```bash
npm run start:prod
```

## Technology Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js
- **Proxy:** http-proxy-middleware
- **Database:** PostgreSQL with Drizzle ORM
- **Build Tool:** TypeScript Compiler (tsc) 