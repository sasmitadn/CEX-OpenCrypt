FROM node:20-alpine

WORKDIR /app

# Install build dependencies if native packages needed
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 50052

CMD ["npm", "start"]
