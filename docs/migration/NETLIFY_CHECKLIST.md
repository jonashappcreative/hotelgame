# Netlify Deployment Checklist

Use this checklist to ensure a smooth deployment to Netlify.

## Pre-Deployment

### ✅ Code Preparation
- [x] All code committed to Git
- [x] Build succeeds locally (`npm run build`)
- [x] No hardcoded API URLs or secrets
- [x] Environment variables use `VITE_` prefix
- [x] `.env` files in `.gitignore`
- [x] `netlify.toml` configuration file created

### ✅ Dependencies
- [x] All dependencies in `package.json`
- [x] `package-lock.json` committed
- [x] No missing peer dependencies

### ✅ Configuration Files
- [x] `netlify.toml` - Build configuration
- [x] `.env.example` - Environment variable template
- [x] `DEPLOYMENT.md` - Deployment guide
- [x] `.gitignore` - Updated with Netlify exclusions

## Netlify Setup

### 1. Create Netlify Site
- [ ] Sign up/login to Netlify
- [ ] Connect GitHub repository
- [ ] Select `main` branch for deployment

### 2. Configure Build Settings
Build settings should auto-populate from `netlify.toml`:
- [ ] Build command: `npm run build`
- [ ] Publish directory: `dist`
- [ ] Node version: 18.17.0

### 3. Environment Variables
Add these in Netlify dashboard (Site settings → Environment variables):

**Required:**
- [ ] `VITE_SUPABASE_URL` - Your Supabase project URL
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` - Your Supabase anon key
- [ ] `VITE_SUPABASE_PROJECT_ID` - Your Supabase project ID

**How to find these values:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to Settings → API
4. Copy the values

### 4. Deploy
- [ ] Click "Deploy site"
- [ ] Wait for build to complete (~2-3 minutes)
- [ ] Verify build logs for errors

## Post-Deployment

### Supabase Configuration
- [ ] Deploy Supabase Edge Functions:
  ```bash
  supabase functions deploy game-action
  ```

- [ ] Update Supabase CORS settings:
  - [ ] Add Netlify URL to Site URL
  - [ ] Add Netlify URL to Redirect URLs

### Verification Tests
Run these tests on the deployed site:

**Authentication:**
- [ ] Sign up with new account works
- [ ] Sign in with existing account works
- [ ] Sign out works

**Local Game:**
- [ ] Can start local game
- [ ] Can place tiles
- [ ] Can found chains
- [ ] Can buy stocks
- [ ] Can complete turn
- [ ] Can discard unplayable tiles

**Online Multiplayer:**
- [ ] Can create room
- [ ] Can join room with code
- [ ] Real-time updates work
- [ ] Game state syncs across players
- [ ] Can complete full game

**Routing:**
- [ ] Direct URL navigation works
- [ ] Browser refresh doesn't 404
- [ ] Back button works correctly

### Performance
- [ ] Page loads in <3 seconds
- [ ] No console errors
- [ ] No broken images/assets
- [ ] Mobile responsive

## Optional Enhancements

### Custom Domain
- [ ] Add custom domain in Netlify
- [ ] Configure DNS records
- [ ] Enable HTTPS (automatic with Netlify)
- [ ] Update Supabase CORS for custom domain

### Monitoring
- [ ] Enable Netlify Analytics (optional)
- [ ] Set up error monitoring (e.g., Sentry)
- [ ] Monitor Supabase usage

### Optimization
- [ ] Enable asset optimization in Netlify
- [ ] Consider code splitting for large bundles
- [ ] Add PWA support (optional)

## Troubleshooting

### Build Fails
1. Check build logs in Netlify
2. Verify it builds locally: `npm run build`
3. Ensure all environment variables are set
4. Check for TypeScript errors

### Runtime Errors
1. Open browser DevTools console
2. Check for CORS errors → Update Supabase settings
3. Check for missing environment variables
4. Verify Supabase Edge Functions are deployed

### 404 Errors
1. Verify `netlify.toml` has SPA redirects
2. Check publish directory is set to `dist`
3. Ensure `index.html` exists in build output

## Support Resources

- [Netlify Documentation](https://docs.netlify.com)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [Supabase Documentation](https://supabase.com/docs)

---

**Deployment Complete! 🎉**

Your site is live at: `https://[your-site-name].netlify.app`
