# Hotel Game - Online Board Game

A digital implementation of the classic hotel chain board game with real-time multiplayer support.

## Project Overview

Hotel Game is a strategic hotel chain building game where players place tiles, found hotel chains, buy stocks, and merge companies to accumulate wealth. This implementation features both local (hot-seat) and online multiplayer modes with real-time synchronization.

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Features

- **Local Multiplayer**: Play on one device with up to 4 players
- **Online Multiplayer**: Real-time gameplay with friends on separate devices
- **Tile Discard System**: Automatic handling of unplayable tiles
- **Real-time Sync**: Powered by Supabase Realtime
- **Authentication**: User accounts and session management
- **Modern UI**: Built with shadcn/ui and Tailwind CSS

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS, shadcn/ui components
- **Backend**: Supabase (PostgreSQL, Realtime, Auth, Edge Functions)
- **Deployment**: Netlify (Frontend), Supabase (Backend)
- **State Management**: React hooks, TanStack Query

## Deployment

### Quick Deploy to Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy)

### Manual Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

**Quick Start:**

1. **Deploy Frontend to Netlify**
   - Connect your GitHub repository to Netlify
   - Configure environment variables (see `.env.example`)
   - Build command: `npm run build`
   - Publish directory: `dist`

2. **Deploy Backend to Supabase**
   ```bash
   supabase functions deploy game-action
   ```

3. **Configure Environment Variables**
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`

For a complete deployment checklist, see [NETLIFY_CHECKLIST.md](./NETLIFY_CHECKLIST.md)

## Custom Domain

You can connect a custom domain to your Netlify deployment:

1. Go to Site settings → Domain management in Netlify
2. Click "Add custom domain"
3. Follow the DNS configuration instructions
4. Update CORS settings in Supabase with your custom domain
