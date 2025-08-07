# Koyeb Deployment Guide

This guide will help you deploy your AI-powered journaling app to Koyeb Hobby.

## Prerequisites

1. **Koyeb Account**: Sign up at [koyeb.com](https://www.koyeb.com)
2. **OpenAI API Key**: Get one from [platform.openai.com](https://platform.openai.com)
3. **Git Repository**: Push your code to GitHub, GitLab, or Bitbucket

## Deployment Steps

### 1. Prepare Your Repository

Make sure your repository contains these files:
- `main.py` - Your FastAPI application
- `requirements.txt` - Python dependencies
- `Procfile` - Tells Koyeb how to run your app
- `runtime.txt` - Specifies Python version
- `.gitignore` - Excludes sensitive files
- All `static/` and `templates/` folders

### 2. Push to Git

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

### 3. Deploy on Koyeb

1. **Login to Koyeb Dashboard**
2. **Click "Create App"**
3. **Choose "GitHub" (or your git provider)**
4. **Select your repository**
5. **Configure deployment**:
   - **Name**: `journal-app` (or your preferred name)
   - **Region**: Choose closest to you
   - **Instance Type**: `Nano` (free tier)
   - **Build Command**: Leave empty (auto-detected)
   - **Run Command**: Leave empty (uses Procfile)

### 4. Set Environment Variables

In the Koyeb dashboard, add these environment variables:

- **OPENAI_API_KEY**: Your OpenAI API key
- **PORT**: `8000` (optional, auto-detected)

### 5. Deploy

Click **"Deploy"** and wait for the build to complete (2-5 minutes).

## Post-Deployment

### Access Your App
Your app will be available at: `https://your-app-name-your-org.koyeb.app`

### Features Available
- ✅ Text journaling with AI assistance
- ✅ Voice mode for hands-free journaling
- ✅ Browse entries by date
- ✅ Historical context and summaries
- ✅ Clear database functionality

### Database Persistence
- SQLite database is created automatically
- Data persists between deployments
- Use "Clear Database" button to reset if needed

## Troubleshooting

### Common Issues

1. **Build Fails**
   - Check `requirements.txt` for correct dependencies
   - Ensure `runtime.txt` has valid Python version

2. **App Won't Start**
   - Verify `Procfile` is correct
   - Check environment variables are set
   - Review build logs in Koyeb dashboard

3. **Voice Mode Not Working**
   - Ensure OPENAI_API_KEY is set correctly
   - Check browser permissions for microphone
   - Voice mode requires HTTPS (automatic on Koyeb)

### Logs and Monitoring
- View logs in Koyeb dashboard under "Runtime logs"
- Monitor performance in "Metrics" tab
- Set up alerts for downtime

## Scaling

### Koyeb Hobby Limits
- **Free tier**: 1 app, limited resources
- **Paid plans**: More apps, better performance, custom domains

### Performance Tips
- Database is in-memory SQLite (fast but limited)
- Consider PostgreSQL for production use
- Monitor memory usage for large conversation histories

## Security

### Environment Variables
- Never commit `.env` files
- Use Koyeb's environment variable system
- Rotate API keys regularly

### HTTPS
- Automatic SSL/TLS on Koyeb
- Required for voice mode (microphone access)
- All traffic encrypted

## Updates

### Deploying Changes
1. Push changes to your git repository
2. Koyeb auto-deploys from main branch
3. Zero-downtime deployments

### Database Migrations
- SQLite schema updates happen automatically
- Use "Clear Database" if schema conflicts occur
- Consider backup strategy for important data

## Support

- **Koyeb Docs**: [koyeb.com/docs](https://www.koyeb.com/docs)
- **FastAPI Docs**: [fastapi.tiangolo.com](https://fastapi.tiangolo.com)
- **OpenAI API**: [platform.openai.com/docs](https://platform.openai.com/docs)

## Cost Estimation

### Koyeb Hobby (Free Tier)
- **Cost**: $0/month
- **Limits**: 1 app, basic resources
- **Perfect for**: Personal use, testing

### Koyeb Starter ($5.50/month)
- **Cost**: ~$5.50/month
- **Benefits**: Better performance, more apps
- **Perfect for**: Regular use, small teams

Your journaling app should run comfortably on the free tier for personal use!
