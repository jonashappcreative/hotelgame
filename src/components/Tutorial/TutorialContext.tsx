import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TutorialContextValue,
  TutorialGameState,
  createInitialTutorialState,
  TOTAL_TUTORIAL_STEPS,
} from './types';
import { tutorialSteps } from './tutorialSteps';
import { TileId, ChainName } from '@/types/game';

const TutorialContext = createContext<TutorialContextValue | null>(null);

export const useTutorial = () => {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error('useTutorial must be used within TutorialProvider');
  }
  return context;
};

interface TutorialProviderProps {
  children: ReactNode;
}

export const TutorialProvider: React.FC<TutorialProviderProps> = ({ children }) => {
  const navigate = useNavigate();
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [tutorialGameState, setTutorialGameState] = useState<TutorialGameState>(createInitialTutorialState);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState<string | null>(null);
  const [interactiveCompleted, setInteractiveCompleted] = useState(false);

  const getCurrentStepConfig = () => tutorialSteps.find(s => s.id === currentStep);

  const startTutorial = useCallback(() => {
    setIsActive(true);
    setCurrentStep(1);
    setTutorialGameState(createInitialTutorialState());
    setValidationError(null);
    setValidationSuccess(null);
    setInteractiveCompleted(false);
  }, []);

  const exitTutorial = useCallback(() => {
    setIsActive(false);
    setCurrentStep(1);
    setTutorialGameState(createInitialTutorialState());
    setValidationError(null);
    setValidationSuccess(null);
    setInteractiveCompleted(false);
    navigate('/');
  }, [navigate]);

  const completeTutorial = useCallback(() => {
    // Mark tutorial as completed in localStorage
    localStorage.setItem('tutorialCompleted', 'true');
    exitTutorial();
  }, [exitTutorial]);

  const goToNextStep = useCallback(() => {
    if (currentStep < TOTAL_TUTORIAL_STEPS) {
      const nextStep = currentStep + 1;
      
      // Special setup when entering step 17 - place Festival chain for merger demo
      if (nextStep === 17) {
        setTutorialGameState(prev => {
          const newState = { ...prev };
          newState.board = new Map(prev.board);
          newState.chains = { ...prev.chains };
          newState.playerStocks = { ...prev.playerStocks };
          newState.stockBank = { ...prev.stockBank };
          
          // Place Festival chain at 6G, 6H, 6I (same row as Sackson, with gap at 6F)
          const festivalTiles = ['6G', '6H', '6I'] as TileId[];
          festivalTiles.forEach(tid => {
            const tile = newState.board.get(tid);
            if (tile) {
              newState.board.set(tid, { ...tile, placed: true, chain: 'festival' });
            }
          });
          
          newState.chains.festival = {
            name: 'festival',
            tiles: festivalTiles,
            isActive: true,
            isSafe: false,
          };
          
          // Give player some Festival stock for the merger demo
          newState.playerStocks.festival = 2;
          newState.stockBank.festival = 23;
          
          return newState;
        });
      }
      
      setCurrentStep(nextStep);
      setValidationError(null);
      setValidationSuccess(null);
      setInteractiveCompleted(false);
    } else {
      completeTutorial();
    }
  }, [currentStep, completeTutorial]);

  const goToPreviousStep = useCallback(() => {
    if (currentStep > 1) {
      // Reset game state based on which step we're going back to
      const targetStep = currentStep - 1;
      
      // Recreate game state for the target step
      const newState = createInitialTutorialState();
      
      // Apply all changes up to target step
      if (targetStep >= 5) {
        // Step 5: Place 6E
        const tile6E = newState.board.get('6E' as TileId);
        if (tile6E) {
          tile6E.placed = true;
        }
      }
      
      if (targetStep >= 8) {
        // Step 7-8: Place 6D and found Sackson
        const tile6D = newState.board.get('6D' as TileId);
        const tile6E = newState.board.get('6E' as TileId);
        if (tile6D) {
          tile6D.placed = true;
          tile6D.chain = 'sackson';
        }
        if (tile6E) {
          tile6E.chain = 'sackson';
        }
        newState.chains.sackson.isActive = true;
        newState.chains.sackson.tiles = ['6E', '6D'] as TileId[];
        newState.playerStocks.sackson = 1;
        newState.stockBank.sackson = 24;
        newState.playerTiles = ['6C', '5E', '4B', '5D'] as TileId[];
      }
      
      if (targetStep >= 11) {
        // Step 11: Bought 2 stocks
        newState.playerStocks.sackson = 3;
        newState.stockBank.sackson = 22;
        newState.playerCash = 5600;
      }
      
      if (targetStep >= 13) {
        // Step 13: Place 6C
        const tile6C = newState.board.get('6C' as TileId);
        if (tile6C) {
          tile6C.placed = true;
          tile6C.chain = 'sackson';
        }
        newState.chains.sackson.tiles = ['6E', '6D', '6C'] as TileId[];
        newState.playerTiles = ['5E', '4B', '5D'] as TileId[];
      }
      
      if (targetStep >= 14) {
        // Step 14: Place 5E
        const tile5E = newState.board.get('5E' as TileId);
        if (tile5E) {
          tile5E.placed = true;
          tile5E.chain = 'sackson';
        }
        newState.chains.sackson.tiles = ['6E', '6D', '6C', '5E'] as TileId[];
        newState.playerTiles = ['4B', '6F'] as TileId[];
      }
      
      if (targetStep >= 17) {
        // Set up Festival chain for merger demo - place directly next to Sackson on same row
        const festivalTiles = ['6G', '6H', '6I'] as TileId[];
        festivalTiles.forEach(tid => {
          const tile = newState.board.get(tid);
          if (tile) {
            tile.placed = true;
            tile.chain = 'festival';
          }
        });
        newState.chains.festival.isActive = true;
        newState.chains.festival.tiles = festivalTiles;
        newState.playerStocks.festival = 2;
        newState.stockBank.festival = 23;
      }
      
      if (targetStep >= 19) {
        // Step 18: Merger executed - 6F connects Sackson and Festival
        const tile6F = newState.board.get('6F' as TileId);
        if (tile6F) {
          tile6F.placed = true;
          tile6F.chain = 'sackson';
        }
        // Festival absorbed into Sackson
        ['6G', '6H', '6I'].forEach(tid => {
          const tile = newState.board.get(tid as TileId);
          if (tile) {
            tile.chain = 'sackson';
          }
        });
        newState.chains.sackson.tiles = ['6E', '6D', '6C', '5E', '6F', '6G', '6H', '6I'] as TileId[];
        newState.chains.festival.isActive = false;
        newState.chains.festival.tiles = [];
        newState.playerTiles = ['4B'] as TileId[];
        // Bonus from merger
        newState.playerCash = 7100; // Added bonus
      }
      
      setTutorialGameState(newState);
      setCurrentStep(targetStep);
      setValidationError(null);
      setValidationSuccess(null);
      setInteractiveCompleted(false);
    }
  }, [currentStep]);

  const validateAction = useCallback((actionType: string, value?: string | number): boolean => {
    const stepConfig = getCurrentStepConfig();
    if (!stepConfig?.expectedAction) return false;

    const { type, value: expectedValue } = stepConfig.expectedAction;
    
    if (actionType !== type) {
      return false;
    }

    if (expectedValue !== undefined && String(value) !== String(expectedValue)) {
      // Provide helpful error messages
      if (type === 'place_tile') {
        setValidationError(`That's not the right tile. Please click the ${expectedValue} tile.`);
      } else if (type === 'select_chain') {
        setValidationError(`Please select ${expectedValue} from the list.`);
      } else if (type === 'buy_stock') {
        setValidationError(`Please buy exactly ${expectedValue} Sackson stocks.`);
      }
      return false;
    }

    // Action is valid - update game state based on action
    setValidationSuccess(getSuccessMessage(type, value));
    setInteractiveCompleted(true);
    
    // Apply the action to tutorial game state
    applyActionToState(actionType, value);
    
    // Auto-advance after 1.5 seconds
    setTimeout(() => {
      goToNextStep();
    }, 1500);
    
    return true;
  }, [currentStep, goToNextStep]);

  const getSuccessMessage = (type: string, value?: string | number): string => {
    switch (type) {
      case 'place_tile':
        if (value === '6F') {
          return `Merger triggered! Sackson absorbs Festival!`;
        }
        return `Perfect! You placed the ${value} tile correctly.`;
      case 'select_chain':
        return `Great! You founded the Sackson chain!`;
      case 'buy_stock':
        return `Excellent! You bought ${value} Sackson stocks.`;
      default:
        return 'Well done!';
    }
  };

  const applyActionToState = useCallback((actionType: string, value?: string | number) => {
    setTutorialGameState(prev => {
      const newState = { ...prev };
      newState.board = new Map(prev.board);
      newState.chains = { ...prev.chains };
      newState.playerStocks = { ...prev.playerStocks };
      newState.stockBank = { ...prev.stockBank };
      
      if (actionType === 'place_tile' && typeof value === 'string') {
        const tileId = value as TileId;
        const tile = newState.board.get(tileId);
        if (tile) {
          newState.board.set(tileId, { ...tile, placed: true });
        }
        newState.playerTiles = prev.playerTiles.filter(t => t !== tileId);
        
        // Special case: 6F triggers a merger between Sackson and Festival
        if (tileId === '6F') {
          // Place the tile as part of the surviving chain (Sackson)
          const mergerTile = newState.board.get(tileId);
          if (mergerTile) {
            mergerTile.chain = 'sackson';
          }
          
          // Convert all Festival tiles to Sackson
          const festivalTiles = newState.chains.festival.tiles;
          festivalTiles.forEach(ftid => {
            const ftile = newState.board.get(ftid);
            if (ftile) {
              ftile.chain = 'sackson';
            }
          });
          
          // Update chain states
          newState.chains.sackson = {
            ...newState.chains.sackson,
            tiles: [...newState.chains.sackson.tiles, tileId, ...festivalTiles],
          };
          newState.chains.festival = {
            name: 'festival',
            tiles: [],
            isActive: false,
            isSafe: false,
          };
          
          // Merger bonus (majority holder gets bonus)
          newState.playerCash += 1500; // Majority bonus for Festival
        } else {
          // Check if this connects to an existing chain
          const adjacentChain = getAdjacentChain(newState.board, tileId);
          if (adjacentChain) {
            const updatedTile = newState.board.get(tileId);
            if (updatedTile) {
              updatedTile.chain = adjacentChain;
            }
            newState.chains[adjacentChain] = {
              ...newState.chains[adjacentChain],
              tiles: [...newState.chains[adjacentChain].tiles, tileId],
            };
          }
        }
      }
      
      if (actionType === 'select_chain' && value === 'sackson') {
        // Found Sackson chain with the two adjacent tiles
        const tile6E = newState.board.get('6E' as TileId);
        const tile6D = newState.board.get('6D' as TileId);
        if (tile6E) tile6E.chain = 'sackson';
        if (tile6D) tile6D.chain = 'sackson';
        
        newState.chains.sackson = {
          name: 'sackson',
          tiles: ['6E', '6D'] as TileId[],
          isActive: true,
          isSafe: false,
        };
        
        // Founder's bonus
        newState.playerStocks.sackson = 1;
        newState.stockBank.sackson = 24;
      }
      
      if (actionType === 'buy_stock' && value === '2') {
        newState.playerStocks.sackson += 2;
        newState.stockBank.sackson -= 2;
        newState.playerCash -= 400;
      }
      
      return newState;
    });
  }, []);

  const getAdjacentChain = (board: Map<TileId, { id: TileId; placed: boolean; chain: ChainName | null }>, tileId: TileId): ChainName | null => {
    const row = parseInt(tileId.slice(0, -1));
    const col = tileId.slice(-1);
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
    const colIndex = cols.indexOf(col);
    
    const adjacentIds: TileId[] = [];
    if (row > 1) adjacentIds.push(`${row - 1}${col}` as TileId);
    if (row < 9) adjacentIds.push(`${row + 1}${col}` as TileId);
    if (colIndex > 0) adjacentIds.push(`${row}${cols[colIndex - 1]}` as TileId);
    if (colIndex < 11) adjacentIds.push(`${row}${cols[colIndex + 1]}` as TileId);
    
    for (const adjId of adjacentIds) {
      const adjTile = board.get(adjId);
      if (adjTile?.chain) {
        return adjTile.chain;
      }
    }
    return null;
  };

  const updateGameState = useCallback((updates: Partial<TutorialGameState>) => {
    setTutorialGameState(prev => ({ ...prev, ...updates }));
  }, []);

  const stepConfig = getCurrentStepConfig();
  const canGoNext = !stepConfig?.isInteractive || interactiveCompleted;
  const canGoBack = currentStep > 1 && stepConfig?.showBack !== false;

  const value: TutorialContextValue = {
    isActive,
    currentStep,
    totalSteps: TOTAL_TUTORIAL_STEPS,
    tutorialGameState,
    validationError,
    validationSuccess,
    canGoNext,
    canGoBack,
    startTutorial,
    exitTutorial,
    goToNextStep,
    goToPreviousStep,
    validateAction,
    setValidationError,
    setValidationSuccess,
    updateGameState,
    completeTutorial,
  };

  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  );
};
