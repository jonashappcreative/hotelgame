// Tutorial system types

import { TileId, ChainName, GameState, PlayerState, ChainState } from '@/types/game';

export interface TutorialStep {
  id: number;
  title: string;
  content: string;
  spotlightSelector?: string;
  spotlightShape?: 'rectangle' | 'circle';
  isInteractive?: boolean;
  interactiveType?: 'place_tile' | 'select_chain' | 'buy_stock' | 'open_info' | 'stock_disposal';
  expectedAction?: {
    type: string;
    value?: string | number;
    values?: string[];
  };
  nextButtonLabel?: string;
  showBack?: boolean;
}

export interface TutorialGameState {
  board: Map<TileId, { id: TileId; placed: boolean; chain: ChainName | null }>;
  chains: Record<ChainName, ChainState>;
  stockBank: Record<ChainName, number>;
  playerCash: number;
  playerStocks: Record<ChainName, number>;
  playerTiles: TileId[];
  currentStep: number;
}

export interface TutorialContextValue {
  // State
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  tutorialGameState: TutorialGameState;
  validationError: string | null;
  validationSuccess: string | null;
  canGoNext: boolean;
  canGoBack: boolean;
  
  // Actions
  startTutorial: () => void;
  exitTutorial: () => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  validateAction: (actionType: string, value?: string | number) => boolean;
  setValidationError: (error: string | null) => void;
  setValidationSuccess: (success: string | null) => void;
  updateGameState: (updates: Partial<TutorialGameState>) => void;
  completeTutorial: () => void;
}

export const TOTAL_TUTORIAL_STEPS = 24;

// Initial tutorial game state
export const createInitialTutorialState = (): TutorialGameState => {
  const board = new Map<TileId, { id: TileId; placed: boolean; chain: ChainName | null }>();
  
  // Initialize empty board
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  for (let row = 1; row <= 9; row++) {
    for (const col of cols) {
      const tileId = `${row}${col}` as TileId;
      board.set(tileId, { id: tileId, placed: false, chain: null });
    }
  }

  const emptyChain = (name: ChainName): ChainState => ({
    name,
    tiles: [],
    isActive: false,
    isSafe: false,
  });

  return {
    board,
    chains: {
      sackson: emptyChain('sackson'),
      tower: emptyChain('tower'),
      worldwide: emptyChain('worldwide'),
      american: emptyChain('american'),
      festival: emptyChain('festival'),
      continental: emptyChain('continental'),
      imperial: emptyChain('imperial'),
    },
    stockBank: {
      sackson: 25,
      tower: 25,
      worldwide: 25,
      american: 25,
      festival: 25,
      continental: 25,
      imperial: 25,
    },
    playerCash: 6000,
    playerStocks: {
      sackson: 0,
      tower: 0,
      worldwide: 0,
      american: 0,
      festival: 0,
      continental: 0,
      imperial: 0,
    },
    playerTiles: ['6E', '6D', '6C', '5E', '4B', '6F'] as TileId[],
    currentStep: 1,
  };
};
