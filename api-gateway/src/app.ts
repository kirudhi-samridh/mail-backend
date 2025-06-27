import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const app = express();
const PORT = process.env.API_GATEWAY_PORT || 3001;

// Middleware
app.use(cors());

// Enhanced logging middleware
app.use((req, res, next) => {
    console.log(`[GW] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    console.log(`[GW] Headers:`, JSON.stringify(req.headers, null, 2));
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`[GW] Body:`, JSON.stringify(req.body, null, 2));
    }
    
    // Log response
    const originalSend = res.send;
    res.send = function(data) {
        console.log(`[GW] Response ${res.statusCode} for ${req.method} ${req.originalUrl}`);
        if (data) {
            try {
                const parsed = JSON.parse(data);
                console.log(`[GW] Response body:`, JSON.stringify(parsed, null, 2));
            } catch (e) {
                console.log(`[GW] Response body (non-JSON):`, data.toString().substring(0, 200));
            }
        }
        return originalSend.call(this, data);
    };
    
    next();
});

// Clean proxy configuration - no path rewriting
const userServiceProxy = createProxyMiddleware({
    target: `http://localhost:${process.env.USER_SERVICE_PORT || 3002}`,
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[GW] Proxying to User Service: ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[GW] User Service responded: ${proxyRes.statusCode} for ${req.originalUrl}`);
    },
    onError: (err, req, res) => {
        console.error(`[GW] User Service proxy error for ${req.originalUrl}:`, err.message);
        res.status(500).json({ message: 'User service unavailable' });
    }
});

const emailServiceProxy = createProxyMiddleware({
    target: `http://localhost:${process.env.EMAIL_SERVICE_PORT || 3003}`,
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[GW] Proxying to Email Service: ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[GW] Email Service responded: ${proxyRes.statusCode} for ${req.originalUrl}`);
    },
    onError: (err, req, res) => {
        console.error(`[GW] Email Service proxy error for ${req.originalUrl}:`, err.message);
        res.status(500).json({ message: 'Email service unavailable' });
    }
});

const aiServiceProxy = createProxyMiddleware({
    target: `http://localhost:${process.env.AI_SERVICE_PORT || 3004}`,
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
        console.log(`[GW] Proxying to AI Service: ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[GW] AI Service responded: ${proxyRes.statusCode} for ${req.originalUrl}`);
    },
    onError: (err, req, res) => {
        console.error(`[GW] AI Service proxy error for ${req.originalUrl}:`, err.message);
        res.status(500).json({ message: 'AI service unavailable' });
    }
});

// Clean routing - direct route handlers without prefix stripping
app.post('/api/auth/signup', userServiceProxy);
app.post('/api/auth/login', userServiceProxy);
app.get('/api/auth/status', userServiceProxy);
app.post('/api/auth/google/callback', emailServiceProxy);
app.get('/api/labels', emailServiceProxy);
app.get('/api/emails', emailServiceProxy);
app.get('/api/emails/:emailId', emailServiceProxy);
app.post('/api/emails/:emailId/summarize', aiServiceProxy);
app.post('/api/ai/generate-content', aiServiceProxy);

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        service: 'api-gateway',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 404 handler
app.use('*', (req, res) => {
    console.log(`[GW] 404 - Route not found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Route not found' });
});

app.listen(PORT, () => {
    console.log(`✅ API Gateway running on http://localhost:${PORT}`);
    console.log(`🔗 User Service: http://localhost:${process.env.USER_SERVICE_PORT || 3002}`);
    console.log(`📧 Email Service: http://localhost:${process.env.EMAIL_SERVICE_PORT || 3003}`);
    console.log(`🤖 AI Service: http://localhost:${process.env.AI_SERVICE_PORT || 3004}`);
}); 
