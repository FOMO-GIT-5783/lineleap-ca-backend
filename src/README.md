# FOMO API Service

A robust, microservice-oriented backend API for the FOMO application, handling payments, authentication, and real-time communication.

## System Requirements

- **Node.js**: v18.x or newer (v20+ recommended)
- **npm**: v8.x or newer
- **MongoDB**: Atlas cluster or local MongoDB v5.0+
- **Stripe Account**: Test mode with API keys
- **Auth0 Account**: With properly configured application
- **Environment**: MacOS, Linux, or Windows with WSL

## ⚙️ Environment Setup

### Required Environment Variables

Create a `.env.development` file in the `/src` directory with the following variables:

```
# Server Configuration
PORT=3001
NODE_ENV=development
LOG_LEVEL=debug

# MongoDB Connection
MONGODB_URI=mongodb+srv://your-mongodb-connection-string
DB_NAME=fomo-db

# Auth0 Configuration
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.yourapp.com
AUTH0_CLIENT_ID=your-auth0-client-id
AUTH0_CLIENT_SECRET=your-auth0-client-secret

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key

# Feature Flags
ENABLE_WEBSOCKETS=true
ENABLE_CACHE=true
ENABLE_MONITORING=true
ENABLE_AUTH_DEBUGGING=true  # Only for development!
```

## 🚀 Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/fomo-fullstack.git
   cd fomo-fullstack
   ```

2. **Install dependencies**:
   ```bash
   cd apps/api
   npm install
   ```

3. **Setup environment variables**:
   - Copy `.env.example` to `.env.development` if it exists
   - Otherwise create a new `.env.development` file in the `/src` directory
   - Fill in all required environment variables as listed above

4. **Verify MongoDB Connection**:
   ```bash
   # Test your MongoDB connection string
   npx mongodb-connection-checker <your-connection-string>
   ```

## 🏃‍♂️ Running the Application

### Development Mode

```bash
cd apps/api
npm run dev
```

This will start a development server with nodemon for hot reloading.

### Production Mode

```bash
cd apps/api
npm run build
npm start
```

## 🔍 Health Checks & Monitoring

### Available Health Endpoints

- **Basic Health**: `GET /health`
- **Detailed Health**: `GET /health/detailed`
- **Database Health**: `GET /health/database`
- **Payment Health**: `GET /health/payment`
- **WebSocket Health**: `GET /health/websocket`

Example:
```bash
curl http://localhost:3001/health/detailed
```

## 🧩 API Services

The API includes the following core services:

### Authentication Service
- Auth0 integration for secure user authentication
- Token validation and permission checking
- User profile management

### Payment Processor
- Stripe integration for payment processing
- Handles payment intents, confirmations, and captures
- Integrated with the transaction system for atomicity

### WebSocket Service
- Real-time communication
- Venue session management
- Events broadcasting

### Database Service
- MongoDB connection pooling
- Schema validation
- Transactional support

### Caching Service
- Local memory cache
- Optional Redis support
- Performance optimization

## 🔧 Troubleshooting

### Common Issues

1. **Stripe Connection Issues**
   - Verify your Stripe API keys are correct
   - Ensure your Stripe account is in test mode for development
   - Check if your account has any verification requirements
   - Run the Stripe functional test script to verify core functionality:
     ```bash
     node src/stripe-functional-test.cjs
     ```

2. **MongoDB Connection Issues**
   - Check network access settings in MongoDB Atlas
   - Verify IP allowlist includes your development machine
   - Ensure username/password in connection string are correct

3. **Auth0 Integration Issues**
   - Verify Auth0 application settings
   - Check redirect URIs and allowed origins
   - Ensure correct scopes are configured

4. **Node.js Version Compatibility**
   - Use `nvm` to install and use the required Node.js version:
     ```bash
     nvm install 20
     nvm use 20
     ```

## 📊 Logs and Diagnostics

Logs are stored in various locations depending on the environment:

- **Development**: Console output
- **Production**: `logs/app.log` with daily rotation

View recent logs:
```bash
# Last 50 lines from application log
tail -n 50 logs/app.log

# Follow logs in real-time
tail -f logs/app.log
```

## 🛡️ Security Considerations

1. **Environment Variables**
   - Never commit `.env` files to version control
   - Rotate credentials regularly
   - Use separate credentials for development and production

2. **Stripe Integration**
   - Always use test mode for development
   - Follow Stripe best practices for handling payments
   - Implement proper idempotency for payment operations

3. **Auth0 Security**
   - Regularly audit permissions and scopes
   - Never expose client secrets in frontend code
   - Use Auth0 rules for additional security checks

## 🌐 API Documentation

API documentation is available at:
- Development: `http://localhost:3001/docs`
- Production: `https://api.yourapp.com/docs`

## 🧪 Testing

Run tests with:
```bash
npm test               # Run all tests
npm run test:unit      # Run unit tests only
npm run test:integration # Run integration tests only
```

## 🤝 Contributing

1. Create a feature branch from `develop`
2. Make your changes
3. Run tests and ensure they pass
4. Submit a pull request

## 📝 License

This project is licensed under the [MIT License](LICENSE). 