# Codebuff Self-Hosting with Docker Compose

This Docker Compose setup makes it easy to self-host Codebuff on your own infrastructure.

## Quick Start

### 1. Create Environment File

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and set at least these **required** values:

```bash
# Required - Your OpenRouter API Key
OPEN_ROUTER_API_KEY=your_real_openrouter_key_here
OPENAI_API_KEY=your_real_openai_key_here

# Optional but recommended - Generate a secure random string
NEXTAUTH_SECRET=$(openssl rand -base64 32)

# Your domain (if running publicly)
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_CODEBUFF_APP_URL=http://localhost:3000
```

### 2. Start Services

```bash
# Build and start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

### 3. Access the App

Open your browser to: http://localhost:3000

## Services

The Docker Compose setup includes:

- **PostgreSQL**: Database (port 5432)
- **Web App**: Next.js server (port 3000)

## Configuration

### Required Variables

Only **one** API key is required:

- `OPEN_ROUTER_API_KEY`: Your OpenRouter API key (recommended - provides access to Claude, GPT, and many other models)
- `OPENAI_API_KEY`: Optional - only needed if you want to use OpenAI directly instead of through OpenRouter

### Optional Variables

**Authentication** (for multi-user setup):

- `CODEBUFF_GITHUB_ID`: GitHub OAuth App ID
- `CODEBUFF_GITHUB_SECRET`: GitHub OAuth App Secret
- `NEXTAUTH_SECRET`: Random secret for session encryption

**Payments** (optional - for production):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET_KEY`
- `STRIPE_USAGE_PRICE_ID`
- `STRIPE_TEAM_FEE_PRICE_ID`

**Analytics & Integrations** (optional):

- `NEXT_PUBLIC_POSTHOG_API_KEY`
- `LINKUP_API_KEY`
- `LOOPS_API_KEY`
- `DISCORD_*` variables

See `.env.example` for all available variables.

## Agent Store

The Agent Store is populated with default agents during initialization. If you need to manually seed agents:

```bash
# Set DATABASE_URL to your PostgreSQL instance
export DATABASE_URL="postgresql://manicode_user_local:secretpassword_local@localhost:5433/manicode_db_local"

# Run the seed script
bun run scripts/seed-default-agents.ts
```

This will:
1. Create a seed user for the self-hosted instance
2. Create the 'codebuff' publisher
3. Load and publish all agents from the `.agents/` directory

## Usage with CLI

To use your self-hosted backend with the Codebuff CLI:

```bash
export CODEBUFF_API_URL=http://localhost:3000
codebuff
```

Or set it permanently in your shell config (`~/.bashrc`, `~/.zshrc`):

```bash
echo 'export CODEBUFF_API_URL=http://localhost:3000' >> ~/.zshrc
```

## Production Deployment

### Domain & HTTPS

For production use:

1. **Update environment variables**:

   ```bash
   NEXTAUTH_URL=https://your-domain.com
   NEXT_PUBLIC_CODEBUFF_APP_URL=https://your-domain.com
   ```

2. **Use a reverse proxy** (nginx, Caddy, Traefik) for HTTPS:

   ```nginx
   server {
       server_name your-domain.com;
       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

3. **Let's Encrypt** for free SSL certificates

### Database Persistence

PostgreSQL data is persisted in a Docker volume (`postgres_data`). Back it up:

```bash
docker compose exec postgres pg_dump -U manicode_user_local manicode_db_local > backup.sql
```

Restore:

```bash
cat backup.sql | docker compose exec -T postgres psql -U manicode_user_local manicode_db_local
```

### Resource Limits

Add to `docker-compose.yml` if needed:

```yaml
services:
  web:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
  postgres:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
```

## Troubleshooting

### Database Connection Issues

Check if PostgreSQL is ready:

```bash
docker compose logs postgres
```

### Build Errors

Rebuild from scratch:

```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f web
docker compose logs -f postgres
```

### Access Shell

```bash
# Web app container
docker compose exec web sh

# Database container
docker compose exec postgres psql -U manicode_user_local manicode_db_local
```

## Updating

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose up -d --build

# Or if using a specific image tag
docker compose pull
docker compose up -d
```

## Security Notes

1. **Never commit `.env`** to version control
2. **Use strong secrets** - generate with `openssl rand -base64 32`
3. **Enable HTTPS** in production
4. **Restrict database access** - don't expose port 5432 publicly
5. **Regular updates** - keep images and dependencies updated
6. **Firewall rules** - only allow necessary ports (80/443)

## License

Codebuff is open-source. See LICENSE file for details.
