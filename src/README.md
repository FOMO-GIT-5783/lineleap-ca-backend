# LineLeap Backend

A robust Node.js/Express backend service for the LineLeap nightlife platform, featuring real-time venue monitoring, pass management, and payment processing.

## Features

- 🔐 **Authentication & Authorization**
  - Auth0 integration
  - Role-based access control
  - Token refresh mechanism
  - Rate limiting

- 🎫 **Pass Management**
  - Digital pass creation and validation
  - QR code generation
  - Real-time pass status tracking
  - Pass redemption system

- 💳 **Payment Processing**
  - Secure Stripe integration
  - Idempotent transactions
  - Payment verification
  - Refund handling

- 🔄 **Real-time WebSocket System**
  - Live venue monitoring
  - Automatic optimization
  - Connection management
  - Session tracking

- 📊 **Health Monitoring**
  - Comprehensive health checks
  - Service status monitoring
  - Performance metrics
  - Circuit breaker implementation

## Getting Started

### Prerequisites

- Node.js (v18+)
- MongoDB
- Redis (optional)
- Stripe Account

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-repo/lineleap-backend.git
cd lineleap-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.development
# Edit .env.development with your configuration
```

4. Start the server:
```bash
npm run dev
```

### Environment Variables

Required environment variables:
```
# Auth0 Configuration
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
AUTH0_ISSUER_BASE_URL=your_auth0_domain
AUTH0_AUDIENCE=your_api_identifier

# Database Configuration
MONGODB_URI=your_mongodb_uri

# Stripe Configuration
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret
```

## API Documentation

### Health Endpoints

- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system health
- `GET /health/websocket` - WebSocket system status
- `GET /health/database` - Database health check

### Authentication

- `POST /api/auth/login` - User login
- `POST /api/auth/callback` - Auth0 callback
- `GET /api/auth/health` - Auth service status

### Pass Management

- `GET /api/passes/my-passes` - Get user's passes
- `POST /api/passes/purchase` - Purchase new pass
- `POST /api/passes/:passId/validate` - Validate pass
- `POST /api/passes/:passId/redeem` - Redeem pass

### Venue Management

- `GET /api/venues` - List venues
- `GET /api/venues/:venueId/metrics` - Get venue metrics
- `GET /api/venues/:venueId/passes` - Get venue passes

## Architecture

The system follows a service-oriented architecture with:
- Service container for dependency injection
- Event-driven communication
- Circuit breaker pattern
- Rate limiting and optimization
- Real-time WebSocket monitoring

## Development

### Running Tests
```bash
npm test                 # Run all tests
npm run test:smoke      # Run smoke tests
npm run test:payments   # Run payment tests
```

### Code Style
The project uses ESLint for code style. Run linting:
```bash
npm run lint
```

### Monitoring
Monitor service health:
```bash
npm run monitor:health
```

## Production Deployment

1. Set up environment:
```bash
cp .env.example .env.production
# Configure production environment variables
```

2. Build and start:
```bash
npm run build
npm start
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is proprietary and confidential.

## Support

For support, email support@lineleap.com or join our Slack channel. 