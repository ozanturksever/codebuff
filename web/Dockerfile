# Build for Codebuff Web App
FROM oven/bun:1.3.5-alpine AS builder
WORKDIR /app

# Copy all source files
COPY . .

# Install dependencies
RUN bun install

# Build-time args for NEXT_PUBLIC_* vars (baked into JS bundle)
ARG NEXT_PUBLIC_CB_ENVIRONMENT=prod
ARG NEXT_PUBLIC_CODEBUFF_APP_URL=http://localhost:9999
ARG NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com
ARG NEXT_PUBLIC_POSTHOG_API_KEY=dummy_posthog_key
ARG NEXT_PUBLIC_POSTHOG_HOST_URL=https://us.i.posthog.com
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_dummy
ARG NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL=https://billing.stripe.com/p/login/dummy
ARG NEXT_PUBLIC_WEB_PORT=9999

# Set build-time env vars
ENV NEXT_PUBLIC_CB_ENVIRONMENT=$NEXT_PUBLIC_CB_ENVIRONMENT
ENV NEXT_PUBLIC_CODEBUFF_APP_URL=$NEXT_PUBLIC_CODEBUFF_APP_URL
ENV NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_PUBLIC_POSTHOG_API_KEY=$NEXT_PUBLIC_POSTHOG_API_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST_URL=$NEXT_PUBLIC_POSTHOG_HOST_URL
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL=$NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL
ENV NEXT_PUBLIC_WEB_PORT=$NEXT_PUBLIC_WEB_PORT

# Server-side env vars needed during build (dummy defaults for self-hosted)
ENV OPENAI_API_KEY=dummy_for_build
ENV OPEN_ROUTER_API_KEY=dummy_for_build
ENV LINKUP_API_KEY=dummy_for_build
ENV PORT=9999
ENV DATABASE_URL=postgresql://user:pass@localhost:5432/db
ENV CODEBUFF_GITHUB_ID=dummy_github_id
ENV CODEBUFF_GITHUB_SECRET=dummy_github_secret
ENV NEXTAUTH_SECRET=dummy_nextauth_secret_at_least_32_chars_long
ENV STRIPE_SECRET_KEY=sk_test_dummy
ENV STRIPE_WEBHOOK_SECRET_KEY=whsec_dummy
ENV STRIPE_USAGE_PRICE_ID=price_dummy
ENV STRIPE_TEAM_FEE_PRICE_ID=price_dummy
ENV LOOPS_API_KEY=dummy_loops_key
ENV DISCORD_PUBLIC_KEY=dummy_discord_key
ENV DISCORD_BOT_TOKEN=dummy_discord_token
ENV DISCORD_APPLICATION_ID=dummy_discord_app_id

# Create empty .env.local if it doesn't exist (needed by Next.js)
RUN touch web/.env.local

# Build app (bypass prebuild script that requires DB)
RUN cd web && bunx next build

# Stage 2: Production
FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app

# Copy all source files (needed for workspace resolution)
COPY . .

# Install production dependencies
RUN bun install --production

# Copy built artifacts from builder
COPY --from=builder /app/web/.next web/.next

# Expose port
EXPOSE 9999

# Set environment
ENV NODE_ENV=production
ENV PORT=9999

# Start app from web directory
WORKDIR /app/web
CMD ["bun", "run", "start"]
