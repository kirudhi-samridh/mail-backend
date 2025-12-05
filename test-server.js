const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3006;

app.use(cors());
app.use(express.json());

// Simple test endpoint to check if the email service is working
app.get('/test/labels', async (req, res) => {
    try {
        console.log('Testing labels endpoint...');
        
        // Make a request to the actual email service
        const response = await fetch('http://localhost:3003/api/labels', {
            headers: {
                'Authorization': req.headers.authorization || 'Bearer test-token'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            res.json({ success: true, data });
        } else {
            const errorText = await response.text();
            res.status(response.status).json({ 
                success: false, 
                status: response.status,
                error: errorText 
            });
        }
    } catch (error) {
        console.error('Test failed:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Test database connection
app.get('/test/db', async (req, res) => {
    try {
        console.log('Testing database connection...');
        
        // Import the database connection
        const { getDb } = require('./shared/db/connection.ts');
        const db = getDb();
        
        // Try a simple query
        const result = await db.query.users.findFirst();
        
        res.json({ 
            success: true, 
            message: 'Database connection successful',
            sampleData: result 
        });
        
    } catch (error) {
        console.error('Database test failed:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        });
    }
});

app.listen(PORT, () => {
    console.log(`🧪 Test server running on http://localhost:${PORT}`);
    console.log('Available test endpoints:');
    console.log('- GET /test/labels - Test the labels endpoint');
    console.log('- GET /test/db - Test database connection');
});
