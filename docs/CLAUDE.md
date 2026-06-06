# Claude Code Project Instructions

## Project Context
- This is an online multiplayer board game (Acquire)
- Uses Supabase for backend (auth, realtime, edge functions)
- Built with React, TypeScript, Vite, and Tailwind CSS

## Before pushing anything to main
- PLease check if Jonas really wants tu push to main, as this triggers an auto deploy. We prever a structure like:

Main < Staging < Development < Feature Branches

- Only wen staging works and is tested locally, push to main upon request.


## Testing Requirements

**IMPORTANT:** Always run all tests before committing to main or develop branches.

```bash
# Run all tests
npm run test:run

# Run tests in watch mode during development
npm test
```

### Test Coverage
- `src/utils/gameLogic.test.ts` - Core game mechanics (tile placement, chains, stocks, scoring)
- `src/utils/multiplayerService.test.ts` - Supabase integration (auth, rooms, realtime)

All tests must pass before merging any changes. If tests fail, fix the issues before committing.
