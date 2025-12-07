# Vector Database Setup Guide

## Step 1: Install PostgreSQL

```bash
# Install PostgreSQL 17 (pgvector supports 17 and 18)
brew install postgresql@17

# Start PostgreSQL service
brew services start postgresql@17

# Add to PATH (add this to your ~/.zshrc for permanent)
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
```

## Step 2: Install pgvector Extension

```bash
# Install pgvector
brew install pgvector
```

## Step 3: Create Database and Extension

```bash
# Connect to PostgreSQL (default user is your macOS username)
psql postgres

# Or if you need to specify user:
# psql -U postgres postgres
```

Then run these SQL commands:

```sql
-- Create the database
CREATE DATABASE counterfeit_ic;

-- Connect to the new database
\c counterfeit_ic

-- Create the pgvector extension
CREATE EXTENSION vector;

-- Verify extension is installed
\dx

-- Exit psql
\q
```

## Step 4: (Optional) Set Environment Variables

If your PostgreSQL uses different credentials, create a `.env` file in the `backend/` directory:

```bash
cd backend
cat > .env << EOF
DB_HOST=localhost
DB_PORT=5432
DB_NAME=counterfeit_ic
DB_USER=your_username
DB_PASSWORD=your_password
EOF
```

Or set them in your shell:

```bash
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=counterfeit_ic
export DB_USER=your_username
export DB_PASSWORD=your_password
```

## Step 5: Verify Setup

The vector database will automatically:
- Create tables on first run
- Set up indexes for fast searching
- Start storing analysis data

You'll see these messages in your API server logs when it's working:
```
[VectorDB] Created connection pool to counterfeit_ic
[VectorDB] Schema initialized successfully
[VectorDB] Loaded embedding model: all-MiniLM-L6-v2
```

## Troubleshooting

### If PostgreSQL connection fails:
1. Check if PostgreSQL is running: `brew services list`
2. Check PostgreSQL is listening: `lsof -i :5432`
3. Verify database exists: `psql -l | grep counterfeit_ic`

### If pgvector extension fails:
1. Make sure pgvector is installed: `brew list pgvector`
2. Check PostgreSQL version: `psql --version`
3. You may need to install pgvector from source if your PostgreSQL version doesn't match

### If you get "permission denied":
- Try connecting as your macOS user: `psql postgres`
- Or create a postgres user: `createuser -s postgres`

## Notes

- The app will work **without** PostgreSQL - it just won't have vector search
- All existing file-based history will continue to work
- Vector search is an enhancement, not a requirement
- Data is stored locally on your machine

