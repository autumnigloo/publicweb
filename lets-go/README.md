# Let's Go

Let's Go is a mobile-friendly TypeScript web game where your physical movement determines which board square you can play.

The app includes four classic abstract games:

- Tic-Tac-Toe
- Gomoku
- Connect Four
- Othello

## Core idea

Instead of tapping any square directly, the app maps your GPS position onto the board.

- Your current location can be calibrated as the center of the board.
- Walking north, south, east, or west moves your in-game cursor accordingly.
- A move is only legal if the square under your current geolocation is legal for that game.
- In Connect Four, only the column matters, so any square in the chosen column maps to the same move.

The goal is to turn board games into a walking activity that encourages moving around outside while still playing a serious strategy game.

## AI approach

The AI uses classical search, not machine learning.

- Iterative deepening alpha-beta search
- Move ordering and lightweight quiescence search
- Game-specific evaluation heuristics
- Time and node budgets chosen from a small on-device benchmark

This makes the AI adapt to weaker and stronger phones while usually trying to return a move in under five seconds.

## Mobile and GPS behavior

- Designed for phone screens
- Uses browser geolocation APIs
- Includes a manual step simulator for desktop testing when GPS is unavailable
- Lets you tune meters-per-cell and overall board footprint in meters

## Tech stack

- TypeScript
- Vite
- Plain DOM/CSS UI, no framework dependency

## Run locally

```bash
npm run dev
```

## Build

```bash
npm run build
```
