import React from 'react';
import { Progress } from '@/components/ui/progress';

interface TutorialProgressProps {
  currentStep: number;
  totalSteps: number;
}

export const TutorialProgress: React.FC<TutorialProgressProps> = ({
  currentStep,
  totalSteps,
}) => {
  const percentage = Math.round((currentStep / totalSteps) * 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Step {currentStep} of {totalSteps}</span>
        <span>{percentage}%</span>
      </div>
      <Progress value={percentage} className="h-1.5" />
    </div>
  );
};
