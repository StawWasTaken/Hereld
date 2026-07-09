# Hereld

A Twitter v2 clone built with the Swiftaw design system — playful, soft, and slightly off-axis.

## 🎨 Design System

This project follows the [Swiftaw](https://github.com/StawWasTaken/Swiftaw) design language:

- **Signature Accent**: #fef83d (bright yellow)
- **Background**: #0d1117 (deep dark)
- **Fonts**: Syne (display), DM Sans (body)
- **Soft tints**: Pink, blue, mint, lilac, peach

## ✨ Features

- **Posts** - 300-character limit, renamed "Reposts" (not retweets)
- **Chronological Feed** - Global feed + Following tab
- **Media Support** - Image uploads, GIFs support, Twemoji support
- **Crowdsourced Moderation** - Mute words, block users, hide content
- **Report Queue** - Simple admin dashboard for reported posts
- Three-column layout (sidebar, feed, widgets)
- Post composer with media tools
- Interactive likes and reposts
- Who to follow suggestions
- Trending topics
- Floating navigation capsule
- Subtle grain texture and ambient glow blobs
- Fully responsive (mobile-first)

## 🚀 Getting Started

Simply open `index.html` in your browser, or serve it locally:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .
```

Then visit `http://localhost:8000`

## 📁 Project Structure

```
/
├── index.html          # Main Hereld page
├── css/
│   └── swiftaw.css    # Swiftaw design system
└── README.md          # This file
```

## 🎯 Design Highlights

- Floating pill navigation with backdrop blur
- Staggered fade-in animations for posts
- Soft chip tokens for tags/badges
- Interactive hover states with color shifts
- Mobile-responsive bottom navigation bar

---

Built with 🛡️ for the Hereld community
