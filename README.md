# FOMO API

The backend service powering the FOMO application, providing authentication, payment processing, and real-time communication capabilities.

## Quick Start

### Prerequisites

- Node.js v18+ (v20+ recommended)
- npm v8+
- MongoDB connection
- Stripe account (test mode)
- Auth0 account

### Setup & Run

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   Create a `.env.development` file in the `src` directory with required variables (see detailed README in `src/README.md`).

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Verify service**:
   ```bash
   curl http://localhost:3001/health
   ```

## Key Features

- **Payment Processing**: Secure Stripe integration
- **Authentication**: Auth0-based user management
- **Real-time Communication**: WebSocket event system
- **Health Monitoring**: Comprehensive system checks
- **Caching**: Performance optimization

## Environment Variables

Essential environment variables:

```
# Minimal required configuration
PORT=3001
NODE_ENV=development
MONGODB_URI=mongodb+srv://...
AUTH0_ISSUER_BASE_URL=https://...
AUTH0_AUDIENCE=https://...
AUTH0_CLIENT_ID=your-id
STRIPE_SECRET_KEY=sk_test_...
```

## Available Commands

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm start            # Run production server
npm test             # Run tests
npm run lint         # Lint code
```

## Documentation

For detailed documentation, see:
- [API Documentation](src/README.md)
- [Environment Setup](src/README.md#environment-setup)
- [Troubleshooting](src/README.md#troubleshooting)

## Service Health

Check service health:
```bash
curl http://localhost:3001/health/detailed
```

## Testing Stripe Integration

The API includes a Stripe functional test script:
```bash
node src/stripe-functional-test.cjs
```

## Need Help?

See the detailed documentation in `src/README.md` for comprehensive setup instructions, troubleshooting, and service details. 