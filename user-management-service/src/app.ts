import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import { getDb, users, userEmailAccounts, type User, type NewUser } from '../../shared/db/connection';

// Load environment variables
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const app = express();
const PORT = process.env.USER_SERVICE_PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Get database connection
const db = getDb();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware (simplified for production)
app.use((req, res, next) => {
    console.log(`[USER_SVC] ${req.method} ${req.path}`);
    next();
});

// JWT Authentication Middleware
interface JWTPayload {
    id: string;
    email: string;
    iat: number;
    exp: number;
}

const authenticateJWT = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                console.error('[USER_SVC] JWT Verification Error:', err.message);
                res.status(403).json({ message: 'Invalid or expired token.' });
                return;
            }
            req.user = user as JWTPayload;
            next();
        });
    } else {
        console.warn('[USER_SVC] Auth token not provided.');
        res.status(401).json({ message: 'Authorization token not provided.' });
    }
};

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            user?: JWTPayload;
        }
    }
}

// Routes
const router = express.Router();

// POST /api/auth/signup
router.post('/api/auth/signup', async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        res.status(400).json({ message: 'Email and password are required.' });
        return;
    }

    try {
        console.log(`[USER_SVC] Creating new user: ${email}`);
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Create new user with Drizzle
        const newUser: NewUser = {
            email,
            passwordHash,
        };
        
        const [createdUser] = await db.insert(users).values(newUser).returning({
            id: users.id,
            email: users.email,
        });
        
        console.log(`[USER_SVC] User created successfully: ${createdUser.id}`);
        
        // Generate JWT token
        const token = jwt.sign(
            { id: createdUser.id, email: createdUser.email }, 
            JWT_SECRET, 
            { expiresIn: '8h' }
        );
        
        res.status(201).json({ user: createdUser, token });
    } catch (error: any) {
        console.error('[USER_SVC] Signup error:', error);
        
        // Handle unique constraint violation (duplicate email)
        if (error.code === '23505') {
            res.status(400).json({ message: 'Email already exists.' });
            return;
        }
        
        res.status(500).json({ message: 'User registration failed.' });
    }
});

// POST /api/auth/login
router.post('/api/auth/login', async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;
    console.log(`[USER_SVC] Login attempt for email: ${email}`);
    
    try {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
        
        if (!user) {
            console.log(`[USER_SVC] User not found: ${email}`);
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }
        
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            console.log(`[USER_SVC] Invalid password for user: ${email}`);
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        console.log(`[USER_SVC] Successful login for user: ${email}`);
        res.status(200).json({
            message: 'Login successful',
            token,
            user: { id: user.id, email: user.email }
        });
    } catch (error: any) {
        console.error(`[USER_SVC] Login error for ${email}:`, error.message);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// Auth Status endpoint - Check if user has Gmail connected
router.get('/api/auth/status', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    console.log(`[USER_SVC] Checking auth status for user: ${userId}`);
    
    try {
        // Check if user has Gmail account connected by looking for refresh token
        const [emailAccount] = await db
            .select({ refreshToken: userEmailAccounts.refreshToken })
            .from(userEmailAccounts)
            .where(eq(userEmailAccounts.userId, userId))
            .limit(1);
        
        const isGoogleConnected = !!emailAccount?.refreshToken;
        
        console.log(`[USER_SVC] Auth status - Gmail connected: ${isGoogleConnected} for user: ${userId}`);
        res.status(200).json({
            authenticated: true,
            isGoogleConnected
        });
    } catch (error: any) {
        console.error(`[USER_SVC] Error checking auth status for user ${userId}:`, error.message);
        res.status(500).json({ message: 'Failed to check authentication status' });
    }
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        status: 'healthy', 
        service: 'user-management-service',
        timestamp: new Date().toISOString()
    });
});

app.use(router);

app.listen(PORT, () => {
    console.log(`✅ User Management Service running on http://localhost:${PORT}`);
}); 