// frontend/src/components/ai-insights/MoveExplanation.tsx
import React, { useEffect, useState } from 'react';
import { getMoveExplanation, MoveExplanation } from '../../api/ai-insights';
import './MoveExplanation.css';

interface MoveExplanationProps {
    gameId: string;
    move: number;
    player: 'player' | 'ai';
    isVisible: boolean;
    onClose: () => void;
}

const MoveExplanationPanel: React.FC<MoveExplanationProps> = ({
    gameId,
    move,
    player,
    isVisible,
    onClose
}) => {
    const [explanation, setExplanation] = useState<MoveExplanation | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isVisible && gameId && move) {
            loadMoveExplanation();
        }
    }, [isVisible, gameId, move, player]);

    const loadMoveExplanation = async () => {
        setLoading(true);
        setError(null);

        try {
            const data = await getMoveExplanation(gameId, move, player);
            setExplanation(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load move explanation');
            console.error('Error loading move explanation:', err);
        } finally {
            setLoading(false);
        }
    };

    const getQualityColor = (quality: string) => {
        switch (quality) {
            case 'excellent': return '#2ecc71';
            case 'good': return '#3498db';
            case 'average': return '#f39c12';
            case 'poor': return '#e67e22';
            case 'blunder': return '#e74c3c';
            default: return '#95a5a6';
        }
    };

    const getQualityIcon = (quality: string) => {
        switch (quality) {
            case 'excellent': return '⭐';
            case 'good': return '👍';
            case 'average': return '➖';
            case 'poor': return '👎';
            case 'blunder': return '💥';
            default: return '❓';
        }
    };

    const renderBoard = (boardState: string[][], highlights: number[] = []) => {
        return (
            <div className="board-visualization">
                {boardState.map((row, rowIndex) => (
                    <div key={rowIndex} className="board-row">
                        {row.map((cell, colIndex) => {
                            const isHighlighted = highlights.includes(colIndex);
                            return (
                                <div
                                    key={colIndex}
                                    className={`board-cell ${cell.toLowerCase()} ${isHighlighted ? 'highlighted' : ''}`}
                                >
                                    {cell !== 'Empty' && (
                                        <div className={`disc ${cell.toLowerCase()}`}></div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        );
    };

    if (!isVisible) return null;

    return (
        <div className="move-explanation-overlay">
            <div className="move-explanation-modal">
                <div className="move-explanation-header">
                    <h2>Move Analysis</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                {loading && (
                    <div className="loading-container">
                        <div className="loading-spinner"></div>
                        <p>Analyzing move...</p>
                    </div>
                )}

                {error && (
                    <div className="error-container">
                        <p className="error-message">⚠️ {error}</p>
                        <button onClick={loadMoveExplanation} className="retry-btn">Retry</button>
                    </div>
                )}

                {explanation && !loading && (
                    <div className="move-explanation-content">
                        {/* Move Overview */}
                        <div className="move-overview">
                            <div className="move-info">
                                <span className="move-number">Move {explanation.metadata.moveNumber}</span>
                                <span className={`player-badge ${player}`}>
                                    {player === 'ai' ? '🤖 AI' : '👤 Player'}
                                </span>
                                <span className="move-phase">{explanation.metadata.gamePhase}</span>
                            </div>

                            <div className="move-quality">
                                <span
                                    className="quality-badge"
                                    style={{ backgroundColor: getQualityColor(explanation.analysis.quality) }}
                                >
                                    {getQualityIcon(explanation.analysis.quality)} {explanation.analysis.quality}
                                </span>
                                <span className="confidence-score">
                                    Confidence: {explanation.analysis.confidence.toFixed(1)}%
                                </span>
                            </div>
                        </div>

                        {/* Board Visualization */}
                        <div className="board-section">
                            <h3>Board State</h3>
                            <div className="board-comparison">
                                <div className="board-state">
                                    <h4>Before Move</h4>
                                    {renderBoard(explanation.boardState.before)}
                                </div>
                                <div className="board-state">
                                    <h4>After Move</h4>
                                    {renderBoard(explanation.boardState.after, explanation.boardState.highlights)}
                                </div>
                            </div>
                        </div>

                        {/* Move Explanation */}
                        <div className="explanation-section">
                            <h3>Move Explanation</h3>
                            <div className="explanation-content">
                                <div className="primary-explanation">
                                    <h4>Primary Reasoning</h4>
                                    <p>{explanation.explanation.primary}</p>
                                </div>

                                <div className="secondary-explanations">
                                    <h4>Additional Insights</h4>
                                    <ul>
                                        {explanation.explanation.secondary.map((insight, index) => (
                                            <li key={index}>{insight}</li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="strategic-tactical">
                                    <div className="strategic">
                                        <h4>Strategic Context</h4>
                                        <p>{explanation.explanation.strategic}</p>
                                    </div>
                                    <div className="tactical">
                                        <h4>Tactical Elements</h4>
                                        <p>{explanation.explanation.tactical}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Alternative Moves */}
                        {explanation.analysis.alternatives.length > 0 && (
                            <div className="alternatives-section">
                                <h3>Alternative Moves</h3>
                                <div className="alternatives-grid">
                                    {explanation.analysis.alternatives.map((alt, index) => (
                                        <div key={index} className="alternative-move">
                                            <div className="alt-column">Column {alt.column}</div>
                                            <div className="alt-score">Score: {alt.score.toFixed(2)}</div>
                                            <div className="alt-reasoning">{alt.reasoning}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Move Statistics */}
                        <div className="move-stats">
                            <h3>Move Statistics</h3>
                            <div className="stats-grid">
                                <div className="stat-item">
                                    <span className="stat-label">Time Spent:</span>
                                    <span className="stat-value">{explanation.metadata.timeSpent}ms</span>
                                </div>
                                <div className="stat-item">
                                    <span className="stat-label">AI Level:</span>
                                    <span className="stat-value">{explanation.metadata.aiLevel}</span>
                                </div>
                                <div className="stat-item">
                                    <span className="stat-label">Move Score:</span>
                                    <span className="stat-value">{explanation.analysis.score.toFixed(2)}</span>
                                </div>
                                <div className="stat-item">
                                    <span className="stat-label">Alternatives:</span>
                                    <span className="stat-value">{explanation.analysis.alternatives.length}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MoveExplanationPanel; 