import { io, Socket } from 'socket.io-client';

export interface Participant {
  userId: string;
  id?: string; // For compatibility
  socketId?: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  joinedAt?: string;
  lastSeen?: string;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  screenSharing?: boolean;
  handRaised?: boolean;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  message: string;
  timestamp: string;
  role: string;
}

export interface RoomJoinedData {
  roomId: string;
  webinar: any;
  participants: Participant[];
  role: string;
}

export interface ParticipantJoinedData {
  user: Participant;
}

export interface ParticipantLeftData {
  userId: string;
  username?: string;
}

export interface MediaChangeData {
  userId: string;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
}

export interface ScreenShareData {
  userId: string;
  username?: string;
}

export interface ReactionData {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  reaction: string;
  timestamp: string;
}

export interface ErrorData {
  message: string;
}

export interface WebRTCSignalData {
  fromUserId: string;
  fromUsername: string;
  fromFirstName?: string;
  fromLastName?: string;
  offer?: any;
  answer?: any;
  candidate?: any;
}

class SocketService {
  private socket: Socket | null = null;
  private eventHandlers: Map<string, Function[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  async connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('=== CONNECTING TO SOCKET SERVER ===');
      
      // Disconnect existing socket if any
      if (this.socket) {
        this.socket.disconnect();
      }

      this.socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000', {
        auth: { token },
        transports: ['websocket', 'polling'],
        timeout: 20000,
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
      });

      this.socket.on('connect', () => {
        console.log('Socket connected successfully:', this.socket?.id);
        this.reconnectAttempts = 0;
        this.setupEventListeners();
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        reject(error);
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        this.emit('disconnect', { reason });
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log('Socket reconnected after', attemptNumber, 'attempts');
        this.emit('reconnect', { attemptNumber });
      });

      this.socket.on('reconnect_error', (error) => {
        console.error('Socket reconnection error:', error);
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.emit('reconnect_failed', { error });
        }
      });

      this.socket.on('error', (error) => {
        console.error('Socket error:', error);
        this.emit('error', error);
      });
    });
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    console.log('Setting up socket event listeners...');

    // Room events
    this.socket.on('room-joined', (data: RoomJoinedData) => {
      console.log('Socket received room-joined:', data);
      this.emit('room-joined', data);
    });

    this.socket.on('participant-joined', (data: ParticipantJoinedData) => {
      console.log('Socket received participant-joined:', data);
      this.emit('participant-joined', data);
    });

    this.socket.on('participant-left', (data: ParticipantLeftData) => {
      console.log('Socket received participant-left:', data);
      this.emit('participant-left', data);
    });

    // Chat events
    this.socket.on('new-message', (message: ChatMessage) => {
      console.log('Socket received new-message:', message);
      this.emit('new-message', message);
    });

    this.socket.on('chat-history', (messages: ChatMessage[]) => {
      console.log('Socket received chat-history:', messages);
      this.emit('chat-history', messages);
    });

    // Media control events
    this.socket.on('participant-audio-changed', (data: MediaChangeData) => {
      console.log('Socket received participant-audio-changed:', data);
      this.emit('participant-audio-changed', data);
    });

    this.socket.on('participant-video-changed', (data: MediaChangeData) => {
      console.log('Socket received participant-video-changed:', data);
      this.emit('participant-video-changed', data);
    });

    // Screen share events
    this.socket.on('screen-share-started', (data: ScreenShareData) => {
      console.log('Socket received screen-share-started:', data);
      this.emit('screen-share-started', data);
    });

    this.socket.on('screen-share-stopped', (data: ScreenShareData) => {
      console.log('Socket received screen-share-stopped:', data);
      this.emit('screen-share-stopped', data);
    });

    // Reaction events
    this.socket.on('new-reaction', (data: ReactionData) => {
      console.log('Socket received new-reaction:', data);
      this.emit('new-reaction', data);
    });

    // Hand raise events
    this.socket.on('hand-raised', (data: any) => {
      console.log('Socket received hand-raised:', data);
      this.emit('hand-raised', data);
    });

    this.socket.on('hand-lowered', (data: any) => {
      console.log('Socket received hand-lowered:', data);
      this.emit('hand-lowered', data);
    });

    // Host control events
    this.socket.on('force-mute', () => {
      console.log('Socket received force-mute');
      this.emit('force-mute', {});
    });

    this.socket.on('removed-from-room', (data: any) => {
      console.log('Socket received removed-from-room:', data);
      this.emit('removed-from-room', data);
    });

    // WebRTC signaling events
    this.socket.on('offer', (data: WebRTCSignalData) => {
      console.log('Socket received offer from:', data.fromUsername, '(' + data.fromUserId + ')');
      this.emit('offer', data);
    });

    this.socket.on('answer', (data: WebRTCSignalData) => {
      console.log('Socket received answer from:', data.fromUsername, '(' + data.fromUserId + ')');
      this.emit('answer', data);
    });

    this.socket.on('ice-candidate', (data: WebRTCSignalData) => {
      console.log('Socket received ice-candidate from:', data.fromUserId);
      this.emit('ice-candidate', data);
    });

    console.log('Socket event listeners setup complete');
  }

  // Event emitter methods
  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }

  // Public event listener registration methods
  onRoomJoined(handler: (data: RoomJoinedData) => void): void {
    this.addEventListener('room-joined', handler);
  }

  onParticipantJoined(handler: (data: ParticipantJoinedData) => void): void {
    this.addEventListener('participant-joined', handler);
  }

  onParticipantLeft(handler: (data: ParticipantLeftData) => void): void {
    this.addEventListener('participant-left', handler);
  }

  onNewMessage(handler: (message: ChatMessage) => void): void {
    this.addEventListener('new-message', handler);
  }

  onChatHistory(handler: (messages: ChatMessage[]) => void): void {
    this.addEventListener('chat-history', handler);
  }

  onParticipantAudioChanged(handler: (data: MediaChangeData) => void): void {
    this.addEventListener('participant-audio-changed', handler);
  }

  onParticipantVideoChanged(handler: (data: MediaChangeData) => void): void {
    this.addEventListener('participant-video-changed', handler);
  }

  onScreenShareStarted(handler: (data: ScreenShareData) => void): void {
    this.addEventListener('screen-share-started', handler);
  }

  onScreenShareStopped(handler: (data: ScreenShareData) => void): void {
    this.addEventListener('screen-share-stopped', handler);
  }

  onNewReaction(handler: (data: ReactionData) => void): void {
    this.addEventListener('new-reaction', handler);
  }

  onHandRaised(handler: (data: any) => void): void {
    this.addEventListener('hand-raised', handler);
  }

  onHandLowered(handler: (data: any) => void): void {
    this.addEventListener('hand-lowered', handler);
  }

  onForceMute(handler: () => void): void {
    this.addEventListener('force-mute', handler);
  }

  onRemovedFromRoom(handler: (data: any) => void): void {
    this.addEventListener('removed-from-room', handler);
  }

  onError(handler: (error: ErrorData) => void): void {
    this.addEventListener('error', handler);
  }

  onDisconnect(handler: (data: { reason: string }) => void): void {
    this.addEventListener('disconnect', handler);
  }

  onReconnect(handler: (data: { attemptNumber: number }) => void): void {
    this.addEventListener('reconnect', handler);
  }

  onReconnectFailed(handler: (data: { error: any }) => void): void {
    this.addEventListener('reconnect_failed', handler);
  }

  // WebRTC signaling event handlers
  onOffer(handler: (data: WebRTCSignalData) => void): void {
    this.addEventListener('offer', handler);
  }

  onAnswer(handler: (data: WebRTCSignalData) => void): void {
    this.addEventListener('answer', handler);
  }

  onIceCandidate(handler: (data: WebRTCSignalData) => void): void {
    this.addEventListener('ice-candidate', handler);
  }

  private addEventListener(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  // Room operations
  joinRoom(data: { roomId: string }): void {
    console.log('Sending join-room event:', data);
    if (this.socket?.connected) {
      this.socket.emit('join-room', data);
    } else {
      console.error('Socket not connected when trying to join room');
    }
  }

  leaveRoom(data: { roomId: string }): void {
    console.log('Sending leave-room event:', data);
    if (this.socket?.connected) {
      this.socket.emit('leave-room', data);
    }
  }

  // Media controls
  toggleAudio(data: { enabled: boolean }): void {
    console.log('Sending toggle-audio event:', data);
    if (this.socket?.connected) {
      this.socket.emit('toggle-audio', data);
    }
  }

  toggleVideo(data: { enabled: boolean }): void {
    console.log('Sending toggle-video event:', data);
    if (this.socket?.connected) {
      this.socket.emit('toggle-video', data);
    }
  }

  startScreenShare(): void {
    console.log('Sending start-screen-share event');
    if (this.socket?.connected) {
      this.socket.emit('start-screen-share', {});
    }
  }

  stopScreenShare(): void {
    console.log('Sending stop-screen-share event');
    if (this.socket?.connected) {
      this.socket.emit('stop-screen-share', {});
    }
  }

  // Chat and reactions
  sendMessage(data: { message: string }): void {
    console.log('Sending send-message event:', data);
    if (this.socket?.connected) {
      this.socket.emit('send-message', data);
    }
  }

  sendReaction(data: { reaction: string }): void {
    console.log('Sending send-reaction event:', data);
    if (this.socket?.connected) {
      this.socket.emit('send-reaction', data);
    }
  }

  // Hand raise
  raiseHand(): void {
    console.log('Sending raise-hand event');
    if (this.socket?.connected) {
      this.socket.emit('raise-hand', {});
    }
  }

  lowerHand(): void {
    console.log('Sending lower-hand event');
    if (this.socket?.connected) {
      this.socket.emit('lower-hand', {});
    }
  }

  // Host controls
  muteParticipant(data: { userId: string }): void {
    console.log('Sending mute-participant event:', data);
    if (this.socket?.connected) {
      this.socket.emit('mute-participant', data);
    }
  }

  removeParticipant(data: { userId: string }): void {
    console.log('Sending remove-participant event:', data);
    if (this.socket?.connected) {
      this.socket.emit('remove-participant', data);
    }
  }

  // WebRTC signaling
  sendOffer(data: { targetUserId: string; offer: any }): void {
    console.log('Sending offer to:', data.targetUserId);
    if (this.socket?.connected) {
      this.socket.emit('offer', data);
    } else {
      console.error('Socket not connected when trying to send offer');
    }
  }

  sendAnswer(data: { targetUserId: string; answer: any }): void {
    console.log('Sending answer to:', data.targetUserId);
    if (this.socket?.connected) {
      this.socket.emit('answer', data);
    } else {
      console.error('Socket not connected when trying to send answer');
    }
  }

  sendIceCandidate(data: { targetUserId: string; candidate: any }): void {
    console.log('Sending ice-candidate to:', data.targetUserId);
    if (this.socket?.connected) {
      this.socket.emit('ice-candidate', data);
    } else {
      console.error('Socket not connected when trying to send ICE candidate');
    }
  }

  // Connection management
  disconnect(): void {
    console.log('Disconnecting socket...');
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.eventHandlers.clear();
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  // Clear specific event handlers
  clearEventHandlers(event?: string): void {
    if (event) {
      this.eventHandlers.delete(event);
    } else {
      this.eventHandlers.clear();
    }
  }

  // Remove specific event listener
  removeEventListener(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // Get connection info for debugging
  getConnectionInfo(): object {
    return {
      connected: this.isConnected(),
      socketId: this.getSocketId(),
      reconnectAttempts: this.reconnectAttempts,
      eventHandlers: Array.from(this.eventHandlers.keys())
    };
  }
}

// Export singleton instance
export const socketService = new SocketService();