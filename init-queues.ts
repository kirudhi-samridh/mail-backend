import { setupOnboardingQueues } from './shared/queues/setup/onboarding-setup';

async function initializeQueues() {
    try {
        console.log('🔄 Initializing LMAA Queue System...');
        
        // Setup onboarding queues
        await setupOnboardingQueues();
        
        console.log('✅ Queue system initialized successfully');
        
        // Keep the process running
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down queue system...');
            const { shutdownOnboardingQueues } = await import('./shared/queues/setup/onboarding-setup');
            await shutdownOnboardingQueues();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            console.log('\n🛑 Shutting down queue system...');
            const { shutdownOnboardingQueues } = await import('./shared/queues/setup/onboarding-setup');
            await shutdownOnboardingQueues();
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Failed to initialize queue system:', error);
        process.exit(1);
    }
}

initializeQueues(); 