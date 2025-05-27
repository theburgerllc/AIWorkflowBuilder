const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.NODE_ENV === 'production' 
  ? process.env.APP_URL 
  : 'http://localhost:3000';

async function testOAuth() {
  console.log('🧪 Testing OAuth Flow...\n');
  
  try {
    // Test 1: Health check
    console.log('1️⃣ Testing health endpoint...');
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check passed:', health.data);
    
    // Test 2: OAuth initiation
    console.log('\n2️⃣ Testing OAuth initiation...');
    const authResponse = await axios.get(`${BASE_URL}/auth/monday`, {
      maxRedirects: 0,
      validateStatus: (status) => status === 302
    });
    
    const location = authResponse.headers.location;
    console.log('✅ OAuth redirect URL:', location);
    
    // Verify URL structure
    const url = new URL(location);
    const requiredParams = ['client_id', 'redirect_uri', 'scope', 'state'];
    const missingParams = requiredParams.filter(p => !url.searchParams.has(p));
    
    if (missingParams.length > 0) {
      console.error('❌ Missing OAuth parameters:', missingParams);
    } else {
      console.log('✅ All OAuth parameters present');
    }
    
    // Display scopes
    const scopes = url.searchParams.get('scope').split(' ');
    console.log(`\n📋 Requested scopes (${scopes.length}):`);
    scopes.forEach(scope => console.log(`   - ${scope}`));
    
    console.log('\n✅ OAuth flow test completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('1. Click the OAuth URL above');
    console.log('2. Authorize the app in Monday.com');
    console.log('3. Check server logs for callback handling');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

// Run tests
testOAuth();