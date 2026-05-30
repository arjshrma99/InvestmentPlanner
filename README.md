# Investment Calculator PWA

Plain HTML/CSS/JavaScript PWA version of the PyQt6 investment calculator, with SIP and SIW calculators.

## Run Locally

From this folder:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## Open On Phone

Use the computer IP address on the same Wi-Fi network:

```text
http://YOUR_COMPUTER_IP:8000
```

## Install On iPhone

Open the app in Safari, then use:

```text
Share -> Add to Home Screen
```

## Install On Android

Open the app in Chrome, then use:

```text
Install app
```

or:

```text
Add to Home screen
```

## Deploy

GitHub Pages:

1. Commit the `investment-calculator-pwa` folder.
2. In repository settings, enable Pages.
3. Select the branch and folder path.

Netlify:

1. Drag this folder into Netlify Drop, or connect the repo.
2. Use this folder as the publish directory.

Vercel:

1. Import the repo.
2. Set this folder as the project root or static output directory.

## Notes

- No backend is required.
- No build step is required.
- Values are saved in `localStorage`.
- The service worker caches the app for offline use after the first load.
