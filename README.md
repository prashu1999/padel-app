# Padel Shuffle

A simple, dependency-free, mobile-first PWA for shuffling padel teams, scoring first-to-two-set games, and tracking a local session leaderboard.

## Run locally

Use any static server from this folder; do not open `index.html` directly because service workers require HTTP(S).

```sh
cd outputs/padel-shuffle
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy

This is a static site: upload every file in this directory without changing the relative paths.

- **GitHub Pages:** publish this directory (or move its contents to the repository's Pages source directory).
- **Netlify:** drag this directory onto Netlify Drop, or set it as the publish directory.
- **Vercel:** deploy it as a static project with this directory as the output directory.

Deploy over HTTPS for PWA installation and offline caching. The service worker uses relative paths, so it also works when hosted under a subdirectory, such as a GitHub Pages project site.

## iPhone installation

Open the deployed HTTPS site in Safari, tap **Share**, then choose **Add to Home Screen**. Session data is stored only in that browser using localStorage; it is not synced and no account is required.

## Scoring notes

- Points progress 0, 15, 30, 40, deuce, advantage, then game.
- Completing a tennis points sequence awards one **set**.
- The first team to win two sets wins one **game**. At 1–1, the third set is the decider.
- Finish all active courts before pressing **Next Game**; the completed game is then recorded in the leaderboard.
- Teammate pairs never repeat within a session. When every valid unique teammate pairing has been used, the session ends and shows the final leaderboard.
- The shuffle records teammate pairings and favors new teammate combinations. In 8-player rotation mode it also favors players with fewer appearances in the current session.
