# Stage 1: Build the React application
# Use a Node.js image to build the React app. We pick a specific version for stability.
FROM node:18-alpine AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (or yarn.lock) to leverage Docker cache
# This step is done separately so npm install is only re-run if dependencies change
COPY package.json ./
# COPY yarn.lock ./ # If you use yarn, otherwise remove this line
COPY package-lock.json ./ # If you use npm, otherwise remove this line

# Install project dependencies
# Use 'npm install' if you use npm, or 'yarn install' if you use yarn
# RUN yarn install --frozen-lockfile
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the React application for production
# This command typically creates a 'build' folder (or 'dist') with optimized static assets
RUN npm run build

# Stage 2: Serve the static files with a lightweight web server
# Use a very lightweight Alpine-based Node.js image for serving
FROM node:18-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy the built application from the 'builder' stage
# The 'build' folder from the first stage is copied to the current stage's working directory
COPY --from=builder /app/build ./

# Install 'serve' globally to serve the static files
# 'serve' is a simple static file server
RUN npm install -g serve

# Expose the port that the 'serve' command will listen on
EXPOSE 8080

# Command to run when the container starts
# This tells 'serve' to serve files from the current directory (which is where the build is)
# and listen on port 8080
CMD ["serve", "-s", ".", "-l", "8080"]
