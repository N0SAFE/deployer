# Progress Visualization System Implementation

## Overview
Create a comprehensive real-time progress tracking and visualization system for deployment pipelines with the following key components:

## Core Requirements

### 1. Real-time Communication Service (NestJS Backend)
- **New NestJS Service**: Create a dedicated progress tracking service
- **WebSocket Integration**: Implement real-time bidirectional communication using Socket.IO or native WebSockets
- **Event Broadcasting**: Send updates to all connected clients simultaneously
- **Progress Event Types**:
    - Step completion events
    - Percentage progress updates
    - Error/warning notifications
    - Status changes (started, in-progress, completed, failed)
- **Client Management**: Handle client connections, disconnections, and room-based broadcasting

### 2. Visual Progress Graph System (New Package)

#### Graph Architecture
- **Node-based Visual System**: Create an interactive graph similar to n8n's workflow editor
- **Custom Node Explorer**: Build our own node visualization component
- **Real-time State Updates**: Nodes should update their visual state based on backend events

#### Node Types and States
- **Step Nodes**: Individual deployment/build steps
- **Progress Bars**: Visual indicators showing percentage completion (0-100%) 
`[Node A] ────────●─────── [Node B]
         ^       ^        ^
         0%     45%      100%
`
- **Status Indicators**: 
    - ✅ Completed (green)
    - 🔄 In Progress (blue/animated)
    - ⏳ Pending (gray)
    - ❌ Failed (red)
    - ⚠️ Warning (yellow)

#### Progress Visualization
- **Percentage Positioning**: When a step is 20% complete, position the progress indicator 20% along the connection line to the next node
- **Animated Transitions**: Smooth animations for progress updates
- **Connection Lines**: Visual connections between steps showing the flow
- **Interactive Elements**: Click nodes for detailed information

### 3. State Management Architecture

#### Frontend State (New Package: `@repo/progress-visualizer`)