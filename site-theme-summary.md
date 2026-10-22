# Site Theme Extraction: Executive Summary

## What it does
A user pastes a website link, and the app automatically shows a preview in that site's own brand colours and logo. Users can adjust the colours or pick a different logo if the suggestion isn't right.

## How it works
1. **Safety check:** the link is checked against Google Safe Browsing, and internal or private addresses are blocked.
2. **Read the site:** only the page's HTML and styles are downloaded. None of the site's code is run.
3. **Filter:** noise such as cookie banners, third-party widgets, framework default colours and social media icons is removed.
4. **AI pick:** a small AI model running locally (Ollama with `tinyllama`) picks the best colours and logo from the options that are left.
5. **Verify:** code checks the AI's answer. If the answer is invalid, the system uses its own ranking instead.

## Why it matters
- **Reliable:** the AI can only choose from options the code has already found. If the AI fails or the site can't be read, the item still saves with the app's default look.
- **Private and low cost:** the AI runs on our own machine, so no data goes to a hosted AI service and there are no per-request fees.
- **Safe:** unsafe sites are rejected, and sizes and timeouts are capped.
- **Reusable:** the whole feature is two server files and a small client helper. Setup steps are in [site-theme-extraction.md](site-theme-extraction.md).

## Requirements
- A Google Safe Browsing API key, stored on the server only.
- Ollama running locally in Docker.

## Current limitations
- It needs a small Node server alongside the React app. The guide includes one.
- Results depend on how clearly each site labels its buttons and logo, which is why users can override them.
