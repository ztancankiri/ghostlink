FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY lib/ ./lib/
COPY server.js .

# Expose the server port (matches default)
EXPOSE 8081

# Command to run the server
# Expects certificates to be mounted at /app/certs
CMD ["node", "server.js", "-h", "0.0.0.0", "-p", "8081", "-k", "certs/server.key", "-c", "certs/server.crt", "-a", "certs/ca.crt"]
