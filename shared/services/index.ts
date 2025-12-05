/**
 * Shared Services - Main Exports
 * 
 * This file serves as the main entry point for all shared services
 * in the LMAA platform. It exports progress tracking, workflow engines,
 * and other reusable service components.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// =============================================
// Shared Middleware & Utilities
// =============================================

export interface JWTPayload {
  id: string;
  email: string;
  subscriptionTier?: string;
  iat: number;
  exp: number;
}

export const createAuthMiddleware = (jwtSecret: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ message: 'Authorization token required' });
      return;
    }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, jwtSecret, (err, user) => {
      if (err) {
        res.status(403).json({ message: 'Invalid or expired token' });
        return;
      }
      req.user = user as JWTPayload;
      next();
    });
  };
};

export const createLoggerMiddleware = (serviceName: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[${serviceName}] ${req.method} ${req.path}`);
    }
    next();
  };
};

export const generateJWT = (user: any, jwtSecret: string): string => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email,
      subscriptionTier: user.subscriptionTier || 'free'
    }, 
    jwtSecret, 
    { expiresIn: '24h' }
  );
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// =============================================
// Progress & Tracking Services (Phase 1 - IMPLEMENTED ✅)
// =============================================
export { 
  ProgressBroadcaster, 
  progressBroadcaster,
  type ProgressMetadata,
  type ProgressStatus,
  type SubTaskProgress,
  type JobResult,
  type ProgressCallback
} from './ProgressBroadcaster';

// =============================================
// Workflow Services (Phase 3 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 3
// export { WorkflowEngine } from './WorkflowEngine';
// export { WorkflowDefinition } from './WorkflowDefinition';
// export { WorkflowExecution } from './WorkflowExecution';

// =============================================
// Data Services (Phase 2 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 2
// export { UniversalStorage } from '../db/UniversalStorage';
// export { ContentProcessor } from './ContentProcessor';
// export { ContentPipeline } from './ContentPipeline';
// export { ProcessingStage } from './ProcessingStage';

// =============================================
// Metrics & Monitoring (Phase 4 - NOT YET IMPLEMENTED ❌)
// =============================================
// TODO: Implement these components in Phase 4
// export { MetricsCollector } from './MetricsCollector';
// export { HealthSystem } from './HealthSystem';
// export { ResourceCalculator } from './ResourceCalculator'; 