import React from "react";
import rightRailStyles from "../Layout/RightRail.module.css";
import { AIChatPanel } from "../AIChatPanel.jsx";
import { ConsolePane } from "./ConsolePane.jsx";
import { TestsPane } from "./TestsPane.jsx";
import { TimingPane } from "./TimingPane.jsx";

// Icons
const RobotIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
);

const TerminalIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5"></polyline>
        <line x1="12" y1="19" x2="20" y2="19"></line>
    </svg>
);

const FlaskIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H15M10 9H14M3 14H21M14 3V8.8C14 9.11828 14.1264 9.42352 14.3515 9.64853L19.5 14.7971C20.1332 15.4303 20.3705 16.3537 20.1171 17.2289C19.8637 18.1041 19.162 18.8 18.2868 19.0534C17.4116 19.3068 16.4882 19.0695 15.855 18.4363L11.5173 14.0986C11.3121 13.8934 10.9796 13.8934 10.7744 14.0986L6.4367 18.4363C5.80348 19.0695 4.88006 19.3068 4.00486 19.0534C3.12966 18.8 2.4279 18.1041 2.17449 17.2289C1.92107 16.3537 2.15842 15.4303 2.79164 14.7971L7.94017 9.64853C8.16527 9.42352 8.29167 9.11828 8.29167 8.8V3"></path>
    </svg>
);

const ClockIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
);

export function RightRail({
    activeRightTab,
    setActiveRightTab,
    showRightRail,
    setShowRightRail,
    responseSummary,
    setResponseSummary,
    response,
    isAiTyping,
    aiChatHistory,
    aiPrompt,
    setAiPrompt,
    handleAiChatSubmit,
    handleChatKeyDown,
    setMethod,
    setUrl,
    setHeadersText,
    setBodyText,
    aiProvider,
    activeModel,
    setActiveModel,
    availableModels,
    chatEndRef,
    history,
    setHistory,
    testsOutput,
    appLogs,
    setAppLogs
}) {

    const handleTabClick = (tab) => {
        if (activeRightTab === tab && showRightRail) {
            setShowRightRail(false); // Toggle off if already active and open
        } else {
            setActiveRightTab(tab);
            setShowRightRail(true);
        }
    };

    return (
        <aside className={showRightRail ? rightRailStyles.rightRail : `${rightRailStyles.rightRail} ${rightRailStyles.collapsed}`}>

            {/* Activity Bar (Vertical Icons when collapsed or on the side when expanded) */}
            <div className={rightRailStyles.activityBar}>
                <button
                    className={`ghost icon-button ${activeRightTab === 'ai' && showRightRail ? rightRailStyles.activeTab : ''}`}
                    onClick={() => handleTabClick('ai')}
                    title="AI Assistant"
                >
                    <RobotIcon />
                </button>
                <button
                    className={`ghost icon-button ${activeRightTab === 'console' && showRightRail ? rightRailStyles.activeTab : ''}`}
                    onClick={() => handleTabClick('console')}
                    title="Console"
                >
                    <TerminalIcon />
                </button>
                <button
                    className={`ghost icon-button ${activeRightTab === 'tests' && showRightRail ? rightRailStyles.activeTab : ''}`}
                    onClick={() => handleTabClick('tests')}
                    title="Test Results"
                >
                    <FlaskIcon />
                </button>
                <button
                    className={`ghost icon-button ${activeRightTab === 'timing' && showRightRail ? rightRailStyles.activeTab : ''}`}
                    onClick={() => handleTabClick('timing')}
                    title="Timing & Performance"
                >
                    <ClockIcon />
                </button>
            </div>

            {/* Expanded Pane Content */}
            {showRightRail && (
                <div className={rightRailStyles.paneContainer}>
                    {activeRightTab === 'ai' && (
                        <AIChatPanel
                            responseSummary={responseSummary}
                            setResponseSummary={setResponseSummary}
                            response={response}
                            isAiTyping={isAiTyping}
                            aiChatHistory={aiChatHistory}
                            aiPrompt={aiPrompt}
                            setAiPrompt={setAiPrompt}
                            handleAiChatSubmit={handleAiChatSubmit}
                            handleChatKeyDown={handleChatKeyDown}
                            setMethod={setMethod}
                            setUrl={setUrl}
                            setHeadersText={setHeadersText}
                            setBodyText={setBodyText}
                            aiProvider={aiProvider}
                            activeModel={activeModel}
                            setActiveModel={setActiveModel}
                            availableModels={availableModels}
                            chatEndRef={chatEndRef}
                            setShowRightRail={setShowRightRail}
                        />
                    )}

                    {activeRightTab === 'console' && (
                        <ConsolePane history={history} setHistory={setHistory} testsOutput={testsOutput} appLogs={appLogs} setAppLogs={setAppLogs} setShowRightRail={setShowRightRail} />
                    )}

                    {activeRightTab === 'tests' && (
                        <TestsPane testsOutput={testsOutput} setShowRightRail={setShowRightRail} />
                    )}

                    {activeRightTab === 'timing' && (
                        <TimingPane response={response} setShowRightRail={setShowRightRail} />
                    )}
                </div>
            )}
        </aside>
    );
}
