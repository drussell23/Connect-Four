import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

interface GamePhase {
    phase: 'opening' | 'midgame' | 'endgame';
    moveCount: number;
    threatLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface PredictionResult {
    move: number;
    probs: number[];
    confidence: number;
    uncertainty?: number[];
    source: 'fast' | 'deep' | 'ensemble';
    reasoning?: string;
}

interface OpponentProfile {
    type: 'aggressive' | 'defensive' | 'balanced' | 'random' | 'expert';
    confidence: number;
    patterns: string[];
    adaptations: number;
}

interface GameMemoryData {
    result: 'win' | 'loss' | 'draw';
    moveHistory: number[];
    opponentId?: string;
}

@Injectable()
export class AdaptiveAIService {
    private readonly logger = new Logger(AdaptiveAIService.name);
    private readonly ML_SERVICE_URL = 'http://localhost:8000';
    private readonly ML_INFERENCE_URL = 'http://localhost:8001';

    // Intelligence memory
    private opponentProfiles = new Map<string, OpponentProfile>();
    private gameMemory = new Map<string, GameMemoryData>();
    private strategyEffectiveness = new Map<string, number>();
    private ensembleWeights = { fast: 0.5, deep: 0.5 };

    /**
     * 🧠 ADAPTIVE PREDICTION ENGINE
     * Intelligently combines multiple AI approaches for superior gameplay
     */
    async adaptivePredict(
        board: string[][],
        gameId: string,
        opponentId?: string,
        moveHistory: number[] = []
    ): Promise<PredictionResult> {
        try {
            // 1. Analyze current game state
            const gamePhase = this.analyzeGamePhase(board, moveHistory);
            const opponentProfile = await this.analyzeOpponent(opponentId, moveHistory);

            this.logger.debug(`Game Phase: ${gamePhase.phase}, Threat: ${gamePhase.threatLevel}`);
            this.logger.debug(`Opponent: ${opponentProfile?.type || 'unknown'}`);

            // 2. Determine optimal AI strategy
            const strategy = this.selectOptimalStrategy(gamePhase, opponentProfile);

            // 3. Get predictions based on strategy
            if (strategy.useEnsemble) {
                return await this.ensemblePrediction(board, gamePhase, opponentProfile);
            } else if (strategy.preferFast) {
                return await this.fastPrediction(board, 'tactical');
            } else {
                return await this.deepPrediction(board, gamePhase);
            }

        } catch (error) {
            this.logger.error(`Adaptive prediction failed: ${error.message}`);
            // Fallback to simple prediction
            return await this.fastPrediction(board, 'fallback');
        }
    }

    /**
     * 🎯 GAME PHASE ANALYSIS
     * Determines current game phase and threat level
     */
    private analyzeGamePhase(board: string[][], moveHistory: number[]): GamePhase {
        const moveCount = moveHistory.length;
        const filledSpaces = board.flat().filter(cell => cell !== 'Empty').length;

        // Check for immediate threats
        const threatLevel = this.assessThreatLevel(board);

        // Determine phase
        let phase: 'opening' | 'midgame' | 'endgame';
        if (moveCount < 8) phase = 'opening';
        else if (filledSpaces < 30) phase = 'midgame';
        else phase = 'endgame';

        return { phase, moveCount, threatLevel };
    }

    /**
     * ⚡ THREAT ASSESSMENT
     * Analyzes immediate tactical threats
     */
    private assessThreatLevel(board: string[][]): 'low' | 'medium' | 'high' | 'critical' {
        let maxThreat = 0;

        // Check for winning moves (critical threat)
        if (this.hasWinningMove(board)) return 'critical';

        // Check for blocking required (high threat)
        if (this.hasBlockingRequired(board)) return 'high';

        // Check for 2-in-a-row threats (medium threat)
        const twoInRowCount = this.countTwoInRowThreats(board);
        if (twoInRowCount >= 2) return 'medium';

        return 'low';
    }

    /**
     * 🤖 OPPONENT ANALYSIS
     * Builds psychological profile of opponent
     */
    private async analyzeOpponent(opponentId: string, moveHistory: number[]): Promise<OpponentProfile | null> {
        if (!opponentId || moveHistory.length < 6) return null;

        const existingProfile = this.opponentProfiles.get(opponentId);

        // Analyze move patterns
        const patterns = this.extractMovePatterns(moveHistory);
        const aggression = this.calculateAggression(moveHistory);
        const consistency = this.calculateConsistency(moveHistory);

        // Determine opponent type
        let type: OpponentProfile['type'];
        if (aggression > 0.7) type = 'aggressive';
        else if (aggression < 0.3) type = 'defensive';
        else if (consistency < 0.4) type = 'random';
        else if (consistency > 0.8) type = 'expert';
        else type = 'balanced';

        const profile: OpponentProfile = {
            type,
            confidence: Math.min(moveHistory.length / 20, 1.0),
            patterns,
            adaptations: existingProfile?.adaptations || 0
        };

        this.opponentProfiles.set(opponentId, profile);
        return profile;
    }

    /**
     * 🧭 STRATEGY SELECTION
     * Chooses optimal AI approach based on context
     */
    private selectOptimalStrategy(gamePhase: GamePhase, opponentProfile: OpponentProfile | null) {
        // Critical situations: Use fast tactical response
        if (gamePhase.threatLevel === 'critical') {
            return { useEnsemble: false, preferFast: true, reason: 'critical_response' };
        }

        // Opening phase: Balance speed and strategy
        if (gamePhase.phase === 'opening') {
            return { useEnsemble: true, reason: 'opening_balance' };
        }

        // Against expert players: Use deep analysis
        if (opponentProfile?.type === 'expert') {
            return { useEnsemble: false, preferFast: false, reason: 'expert_opponent' };
        }

        // Endgame: Strategic depth crucial
        if (gamePhase.phase === 'endgame') {
            return { useEnsemble: false, preferFast: false, reason: 'endgame_strategy' };
        }

        // Default: Ensemble approach
        return { useEnsemble: true, reason: 'balanced_approach' };
    }

    /**
     * 🎭 ENSEMBLE PREDICTION
     * Combines multiple AI approaches with intelligent weighting
     */
    private async ensemblePrediction(
        board: string[][],
        gamePhase: GamePhase,
        opponentProfile: OpponentProfile | null
    ): Promise<PredictionResult> {
        // Get predictions from both services in parallel
        const [fastResult, deepResult] = await Promise.all([
            this.fastPrediction(board, 'ensemble_fast'),
            this.deepPrediction(board, gamePhase)
        ]);

        // Dynamic weight adjustment based on context
        const weights = this.calculateEnsembleWeights(gamePhase, opponentProfile);

        // Combine predictions with confidence weighting
        const combinedProbs = fastResult.probs.map((prob, i) =>
            prob * weights.fast + deepResult.probs[i] * weights.deep
        );

        const move = combinedProbs.indexOf(Math.max(...combinedProbs));
        const confidence = Math.max(...combinedProbs);

        return {
            move,
            probs: combinedProbs,
            confidence,
            source: 'ensemble',
            reasoning: `Combined fast (${weights.fast.toFixed(2)}) + deep (${weights.deep.toFixed(2)}) analysis`
        };
    }

    /**
     * ⚡ FAST PREDICTION
     * Quick tactical analysis using ML-Inference
     */
    private async fastPrediction(board: string[][], context: string): Promise<PredictionResult> {
        try {
            const response = await axios.post(`${this.ML_INFERENCE_URL}/predict`, {
                board,
                include_uncertainty: true
            });

            return {
                ...response.data,
                source: 'fast',
                reasoning: `Fast tactical analysis (${context})`
            };
        } catch (error) {
            this.logger.error(`Fast prediction failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * 🧠 DEEP PREDICTION
     * Strategic analysis using ML Service
     */
    private async deepPrediction(board: string[][], gamePhase: GamePhase): Promise<PredictionResult> {
        try {
            const response = await axios.post(`${this.ML_SERVICE_URL}/predict`, {
                board,
                include_uncertainty: true,
                model_type: gamePhase.phase === 'endgame' ? 'strategic' : 'standard'
            });

            return {
                ...response.data,
                source: 'deep',
                reasoning: `Deep strategic analysis (${gamePhase.phase})`
            };
        } catch (error) {
            this.logger.error(`Deep prediction failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * ⚖️ DYNAMIC WEIGHT CALCULATION
     * Adjusts ensemble weights based on context
     */
    private calculateEnsembleWeights(gamePhase: GamePhase, opponentProfile: OpponentProfile | null) {
        let fastWeight = 0.5;
        let deepWeight = 0.5;

        // Adjust for game phase
        switch (gamePhase.phase) {
            case 'opening':
                fastWeight = 0.6; // Favor speed in opening
                break;
            case 'endgame':
                deepWeight = 0.7; // Favor strategy in endgame
                break;
        }

        // Adjust for threat level
        if (gamePhase.threatLevel === 'critical') {
            fastWeight = 0.8; // Emergency response
        }

        // Adjust for opponent
        if (opponentProfile?.type === 'expert') {
            deepWeight = 0.7; // Need deeper analysis
        } else if (opponentProfile?.type === 'random') {
            fastWeight = 0.7; // Simple responses work
        }

        // Normalize
        const total = fastWeight + deepWeight;
        return {
            fast: fastWeight / total,
            deep: deepWeight / total
        };
    }

    // Helper methods for game analysis
    private hasWinningMove(board: string[][]): boolean {
        // Implementation for checking winning moves
        return false; // Placeholder
    }

    private hasBlockingRequired(board: string[][]): boolean {
        // Implementation for checking blocking requirements
        return false; // Placeholder
    }

    private countTwoInRowThreats(board: string[][]): number {
        // Implementation for counting two-in-a-row threats
        return 0; // Placeholder
    }

    private extractMovePatterns(moveHistory: number[]): string[] {
        // Analyze patterns in opponent moves
        const patterns = [];

        // Check for center preference
        const centerMoves = moveHistory.filter(move => move === 3).length;
        if (centerMoves / moveHistory.length > 0.4) {
            patterns.push('center_preference');
        }

        // Check for edge avoidance
        const edgeMoves = moveHistory.filter(move => move === 0 || move === 6).length;
        if (edgeMoves / moveHistory.length < 0.2) {
            patterns.push('edge_avoidance');
        }

        return patterns;
    }

    private calculateAggression(moveHistory: number[]): number {
        // Calculate aggression score based on move choices
        // Placeholder implementation
        return 0.5;
    }

    private calculateConsistency(moveHistory: number[]): number {
        // Calculate consistency in move patterns
        // Placeholder implementation
        return 0.5;
    }

    /**
     * 📊 LEARNING & ADAPTATION
     * Updates AI effectiveness based on game results
     */
    async updateFromGameResult(
        gameId: string,
        result: 'win' | 'loss' | 'draw',
        opponentId?: string,
        moveHistory: number[] = []
    ): Promise<void> {
        // Store game memory
        this.gameMemory.set(gameId, { result, moveHistory, opponentId });

        // Update strategy effectiveness
        const strategyKey = `ensemble_${moveHistory.length}`;
        const currentEffect = this.strategyEffectiveness.get(strategyKey) || 0.5;
        const newEffect = result === 'win' ? currentEffect + 0.1 : currentEffect - 0.05;
        this.strategyEffectiveness.set(strategyKey, Math.max(0.1, Math.min(0.9, newEffect)));

        // Adapt ensemble weights for opponent
        if (opponentId) {
            const profile = this.opponentProfiles.get(opponentId);
            if (profile) {
                profile.adaptations += 1;
                this.opponentProfiles.set(opponentId, profile);
            }
        }

        this.logger.log(`Updated AI from game ${gameId}: ${result}`);
    }
} 