// Global test setup
module.exports = async () => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // Use random port for tests
  process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests
  
  // Mock environment variables if not set
  if (!process.env.MONDAY_CLIENT_ID) {
    process.env.MONDAY_CLIENT_ID = 'test_client_id';
  }
  
  if (!process.env.MONDAY_CLIENT_SECRET) {
    process.env.MONDAY_CLIENT_SECRET = 'test_client_secret';
  }
  
  if (!process.env.MONDAY_SIGNING_SECRET) {
    process.env.MONDAY_SIGNING_SECRET = 'test_signing_secret';
  }
  
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = 'test_anthropic_key';
  }
  
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test_jwt_secret';
  }
  
  console.log('Global test setup completed');
};
