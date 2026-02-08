import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTutorial, TutorialOverlay } from '@/components/Tutorial';
import { tutorialSteps } from '@/components/Tutorial/tutorialSteps';
import { TutorialGameBoard } from '@/components/Tutorial/TutorialGameBoard';
import { TutorialPlayerHand } from '@/components/Tutorial/TutorialPlayerHand';
import { TutorialPlayerInfo } from '@/components/Tutorial/TutorialPlayerInfo';
import { TutorialChainSelector } from '@/components/Tutorial/TutorialChainSelector';
import { TutorialStockPurchase } from '@/components/Tutorial/TutorialStockPurchase';
import { TutorialInfoCard } from '@/components/Tutorial/TutorialInfoCard';
import { TileId, ChainName } from '@/types/game';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Home, Play, RotateCcw } from 'lucide-react';

const TutorialPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    isActive,
    currentStep,
    tutorialGameState,
    validateAction,
    startTutorial,
    exitTutorial,
    completeTutorial,
  } = useTutorial();
  
  const [selectedTile, setSelectedTile] = useState<TileId | null>(null);
  const [showChainSelector, setShowChainSelector] = useState(false);
  const [showStockPurchase, setShowStockPurchase] = useState(false);

  // Start tutorial on mount
  useEffect(() => {
    if (!isActive) {
      startTutorial();
    }
  }, [isActive, startTutorial]);

  // Handle step changes
  useEffect(() => {
    // Reset UI state on step change
    setSelectedTile(null);
    setShowChainSelector(false);
    setShowStockPurchase(false);

    // Show chain selector for step 8
    if (currentStep === 8) {
      setShowChainSelector(true);
    }
    
    // Show stock purchase for step 11
    if (currentStep === 11) {
      setShowStockPurchase(true);
    }
  }, [currentStep]);

  const handleTileClick = (tileId: TileId) => {
    const stepConfig = tutorialSteps.find(s => s.id === currentStep);
    
    if (stepConfig?.interactiveType === 'place_tile') {
      if (selectedTile === tileId) {
        // Tile is already selected, attempt to place
        const isValid = validateAction('place_tile', tileId);
        if (isValid) {
          setSelectedTile(null);
          // Check if this triggers chain founding (step 7 -> 8)
          if (currentStep === 7) {
            setTimeout(() => setShowChainSelector(true), 500);
          }
        }
      } else {
        setSelectedTile(tileId);
      }
    }
  };

  const handleBoardTileClick = (tileId: TileId) => {
    const stepConfig = tutorialSteps.find(s => s.id === currentStep);
    
    // For tile placement steps, a single click on the correct board tile should work
    if (stepConfig?.interactiveType === 'place_tile') {
      const expectedTile = stepConfig.expectedAction?.value;
      if (tileId === expectedTile) {
        const isValid = validateAction('place_tile', tileId);
        if (isValid) {
          setSelectedTile(null);
          if (currentStep === 7) {
            setTimeout(() => setShowChainSelector(true), 500);
          }
        }
      }
    }
  };

  const handleChainSelect = (chain: ChainName) => {
    const isValid = validateAction('select_chain', chain);
    if (isValid) {
      setShowChainSelector(false);
    }
  };

  const handleStockPurchase = (quantity: number) => {
    const isValid = validateAction('buy_stock', String(quantity));
    if (isValid) {
      setShowStockPurchase(false);
    }
  };

  const getCurrentStepConfig = () => tutorialSteps.find(s => s.id === currentStep);
  const stepConfig = getCurrentStepConfig();

  // Get highlighted tile for current step
  const getHighlightedTile = (): TileId | undefined => {
    if (!stepConfig?.expectedAction) return undefined;
    if (stepConfig.interactiveType === 'place_tile') {
      return stepConfig.expectedAction.value as TileId;
    }
    return undefined;
  };

  // Tutorial completion screen (step 24)
  if (currentStep === 24 && !showChainSelector && !showStockPurchase) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <TutorialOverlay />
        
        <Card className="max-w-md w-full shadow-lg">
          <CardHeader className="text-center">
            <div className="text-4xl mb-2">🎉</div>
            <CardTitle className="text-2xl">Tutorial Complete!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-center">
              You've learned the basics of Acquire. Time to put your skills to the test!
            </p>
            
            <div className="space-y-2">
              <Button
                className="w-full gap-2"
                onClick={() => {
                  completeTutorial();
                  navigate('/');
                }}
              >
                <Play className="w-4 h-4" />
                Start a Game
              </Button>
              
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => {
                  startTutorial();
                }}
              >
                <RotateCcw className="w-4 h-4" />
                Replay Tutorial
              </Button>
              
              <Button
                variant="ghost"
                className="w-full gap-2"
                onClick={() => {
                  completeTutorial();
                  navigate('/');
                }}
              >
                <Home className="w-4 h-4" />
                Back to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main tutorial view with game board
  const showGameUI = currentStep >= 3;

  return (
    <div className="min-h-screen bg-background">
      {/* Tutorial Overlay (spotlight + tooltip) */}
      <TutorialOverlay />
      
      {/* Game UI */}
      {showGameUI && (
        <div className="container mx-auto p-4 pt-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
            {/* Main game area */}
            <div className="space-y-4">
              <TutorialGameBoard
                gameState={tutorialGameState}
                highlightedTile={getHighlightedTile()}
                onTileClick={handleBoardTileClick}
              />
              
              {/* Chain selector modal */}
              {showChainSelector && (
                <div className="fixed inset-0 z-30 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                  <TutorialChainSelector
                    gameState={tutorialGameState}
                    onSelectChain={handleChainSelect}
                    allowedChain="sackson"
                  />
                </div>
              )}
            </div>
            
            {/* Sidebar */}
            <div className="space-y-4">
              <TutorialPlayerInfo gameState={tutorialGameState} />
              
              {/* Show Info Card from step 15 onwards */}
              {currentStep >= 15 && (
                <TutorialInfoCard gameState={tutorialGameState} />
              )}
              
              {showStockPurchase ? (
                <TutorialStockPurchase
                  gameState={tutorialGameState}
                  onPurchase={handleStockPurchase}
                  targetQuantity={2}
                />
              ) : (
                <TutorialPlayerHand
                  gameState={tutorialGameState}
                  highlightedTile={getHighlightedTile()}
                  onTileClick={handleTileClick}
                  selectedTile={selectedTile}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TutorialPage;
