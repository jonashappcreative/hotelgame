# Deployment Guide - Netlify

This guide covers deploying the Hotel Game board game application to Netlify.

## Overview

This is a Vite + React + TypeScript application with Supabase backend integration. The frontend is deployed to Netlify, while the Supabase Edge Functions are deployed separately to Supabase.

## Prerequisites

1. **Netlify Account**: Sign up at [netlify.com](https://netlify.com)
2. **Supabase Project**: Your Supabase project should already be set up
3. **Git Repository**: Code should be pushed to GitHub (already done)
4. **Node.js**: Version 18.x or higher

## Build Configuration

### Build Settings

- **Build Command**: `npm run build`
- **Publish Directory**: `dist`
- **Node Version**: 18.17.0

These are configured in `netlify.toml` and will be automatically applied.

## Required Environment Variables

You **must** configure the following environment variables in Netlify:

### Supabase Configuration

1. **`VITE_SUPABASE_URL`**
   - Your Supabase project URL
   - Example: `https://bkpjepbefcpmyczbtnot.supabase.co`
   - Found in: Supabase Dashboard → Project Settings → API

2. **`VITE_SUPABASE_PUBLISHABLE_KEY`**
   - Your Supabase anon/public key
   - Example: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
   - Found in: Supabase Dashboard → Project Settings → API → anon public

3. **`VITE_SUPABASE_PROJECT_ID`**
   - Your Supabase project ID
   - Example: `bkpjepbefcpmyczbtnot`
   - Found in: Supabase Dashboard → Project Settings → General

### How to Add Environment Variables in Netlify

1. Go to your Netlify site dashboard
2. Navigate to **Site settings** → **Environment variables**
3. Click **Add a variable**
4. Add each variable with its key and value
5. Click **Save**

## Deployment Steps

### Option 1: Deploy via Netlify UI (Recommended)

1. **Connect Repository**
   - Log in to [Netlify](https://app.netlify.com)
   - Click **Add new site** → **Import an existing project**
   - Choose **GitHub** and authorize Netlify
   - Select the `aquire02` repository

2. **Configure Build Settings**
   - Netlify will auto-detect the settings from `netlify.toml`
   - Verify:
     - Build command: `npm run build`
     - Publish directory: `dist`
     - Branch: `main`

3. **Add Environment Variables**
   - Before deploying, add all required environment variables (see above)
   - Go to **Site settings** → **Environment variables**
   - Add all three Supabase variables

4. **Deploy**
   - Click **Deploy site**
   - Wait for the build to complete (typically 2-3 minutes)
   - Your site will be live at a Netlify subdomain (e.g., `random-name-123.netlify.app`)

### Option 2: Deploy via Netlify CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Initialize the site
netlify init

# Deploy
netlify deploy --prod
```

## Post-Deployment Configuration

### 1. Custom Domain (Optional)

1. Go to **Site settings** → **Domain management**
2. Click **Add custom domain**
3. Follow the instructions to configure DNS

### 2. Configure Supabase Edge Functions

The Supabase Edge Functions (`supabase/functions/game-action`) are **not** deployed to Netlify. They must be deployed to Supabase:

```bash
# Make sure you're logged in to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref bkpjepbefcpmyczbtnot

# Deploy the edge function
supabase functions deploy game-action
```

### 3. Update CORS Settings in Supabase

After deploying to Netlify, update your Supabase CORS settings:

1. Go to Supabase Dashboard → Authentication → URL Configuration
2. Add your Netlify domain to **Site URL** and **Redirect URLs**:
   - `https://your-site-name.netlify.app`
   - `https://your-custom-domain.com` (if using custom domain)

### 4. Verify Deployment

Test the following functionality:

- ✅ **Local Play**: Start a local game with 4 players
- ✅ **Online Multiplayer**: Create and join rooms
- ✅ **Authentication**: Sign up / Sign in functionality
- ✅ **Tile Placement**: Place tiles on the board
- ✅ **Tile Discard**: Discard unplayable tiles
- ✅ **Real-time Sync**: Changes sync across multiple browsers

## Continuous Deployment

Netlify automatically deploys on every push to the `main` branch:

1. Make changes locally
2. Commit and push to GitHub
3. Netlify automatically builds and deploys
4. Check the deploy log in Netlify dashboard

### Branch Previews

Netlify creates preview deployments for pull requests:

1. Create a new branch
2. Push to GitHub
3. Open a pull request
4. Netlify creates a preview URL
5. Test changes before merging

## Troubleshooting

### Build Fails

**Error: "Module not found"**
- Ensure all dependencies are in `package.json`
- Try: `npm install` locally and commit updated `package-lock.json`

**Error: "TypeScript errors"**
- Fix TypeScript errors locally first
- Run `npm run build` to verify it works

### Environment Variables Not Working

- Ensure variable names start with `VITE_` (required for Vite)
- Variables must be added before the build
- Redeploy after adding variables: **Deploys** → **Trigger deploy** → **Clear cache and deploy**

### Supabase Connection Issues

- Verify environment variables are correct
- Check CORS settings in Supabase
- Ensure Supabase Edge Functions are deployed

### Routing Issues (404 on refresh)

- The `netlify.toml` includes SPA redirect rules
- If you get 404s, verify the `netlify.toml` file is committed

## Security Checklist

- ✅ Environment variables configured (not hardcoded)
- ✅ `.env` and `.env.local` in `.gitignore`
- ✅ Supabase RLS policies enabled
- ✅ CORS configured properly
- ✅ Security headers configured in `netlify.toml`

## Monitoring

Monitor your deployment:

1. **Netlify Analytics**: Track page views and performance
2. **Supabase Logs**: Monitor database and Edge Function logs
3. **Browser DevTools**: Check for console errors

## Support

For deployment issues:
- Netlify Docs: https://docs.netlify.com
- Supabase Docs: https://supabase.com/docs
- Vite Docs: https://vitejs.dev

## Quick Reference

```bash
# Local development
npm run dev

# Production build (test locally)
npm run build
npm run preview

# Deploy to Netlify (via CLI)
netlify deploy --prod

# Deploy Supabase functions
supabase functions deploy game-action
```

---

**Last Updated**: February 1, 2026
