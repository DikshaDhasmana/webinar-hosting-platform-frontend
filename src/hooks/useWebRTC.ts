import { useEffect, useRef, useState, useCallback } from 'react'
import Peer from 'simple-peer'
import { socketService, Participant } from '../services/socketService'

export interface PeerConnection {
  peerId: string
  peer: Peer.Instance
  stream?: MediaStream
  userId: string
  username: string
  firstName?: string
  lastName?: string
  role?: string
  audioEnabled?: boolean
  videoEnabled?: boolean
  screenSharing?: boolean
}

export const useWebRTC = (roomId: string, userId: string, localStream: MediaStream | null) => {
  const [peers, setPeers] = useState<PeerConnection[]>([])
  const [connectionStates, setConnectionStates] = useState<{ [userId: string]: string }>({})
  const peersRef = useRef<PeerConnection[]>([])
  const isInitialized = useRef(false)

  // Create peer connection
  const createPeer = useCallback((
    targetUserId: string, 
    targetUsername: string, 
    targetUserData: Participant,
    stream: MediaStream, 
    initiator: boolean = false
  ) => {
    console.log(`Creating peer for ${targetUsername} (${targetUserId}) as ${initiator ? 'initiator' : 'receiver'}`)

    const peer = new Peer({
      initiator,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    })

    peer.on('signal', (signal) => {
      console.log('Sending signal:', signal.type, 'to', targetUsername)
      if (signal.type === 'offer') {
        socketService.sendOffer({ targetUserId, offer: signal })
      } else if (signal.type === 'answer') {
        socketService.sendAnswer({ targetUserId, answer: signal })
      } else {
        // ICE candidates
        socketService.sendIceCandidate({ targetUserId, candidate: signal })
      }
    })

    peer.on('stream', (remoteStream) => {
      console.log('Received remote stream from:', targetUsername)
      setPeers(prevPeers => {
        const updatedPeers = prevPeers.map(p =>
          p.userId === targetUserId
            ? { ...p, stream: remoteStream }
            : p
        )
        peersRef.current = updatedPeers
        return updatedPeers
      })

      setConnectionStates(prev => ({
        ...prev,
        [targetUserId]: 'connected'
      }))
    })

    peer.on('connect', () => {
      console.log('Peer connected:', targetUsername)
      setConnectionStates(prev => ({
        ...prev,
        [targetUserId]: 'connected'
      }))
    })

    peer.on('error', (err) => {
      console.error('Peer error with', targetUsername, ':', err)
      setConnectionStates(prev => ({
        ...prev,
        [targetUserId]: 'failed'
      }))
    })

    peer.on('close', () => {
      console.log('Peer connection closed:', targetUsername)
      removePeer(targetUserId)
    })

    const peerConnection: PeerConnection = {
      peerId: targetUserId,
      peer,
      userId: targetUserId,
      username: targetUsername,
      firstName: targetUserData.firstName,
      lastName: targetUserData.lastName,
      role: targetUserData.role,
      audioEnabled: targetUserData.audioEnabled,
      videoEnabled: targetUserData.videoEnabled,
      screenSharing: targetUserData.screenSharing
    }

    peersRef.current.push(peerConnection)
    setPeers(prevPeers => [...prevPeers, peerConnection])

    setConnectionStates(prev => ({
      ...prev,
      [targetUserId]: 'connecting'
    }))

    return peer
  }, [])

  // Remove peer connection
  const removePeer = useCallback((userId: string) => {
    console.log('Removing peer:', userId)
    const peerConnection = peersRef.current.find(p => p.userId === userId)
    if (peerConnection) {
      try {
        peerConnection.peer.destroy()
      } catch (error) {
        console.error('Error destroying peer:', error)
      }
      
      peersRef.current = peersRef.current.filter(p => p.userId !== userId)
      setPeers(prevPeers => prevPeers.filter(p => p.userId !== userId))
      
      setConnectionStates(prev => {
        const newStates = { ...prev }
        delete newStates[userId]
        return newStates
      })
    }
  }, [])

  // Handle incoming offer
  const handleOffer = useCallback((data: { fromUserId: string; fromUsername: string; offer: any }) => {
    if (!localStream) {
      console.error('No local stream available to handle offer')
      return
    }

    console.log('Received offer from:', data.fromUsername, '(', data.fromUserId, ')')
    
    // Check if we already have a peer for this user
    const existingPeer = peersRef.current.find(p => p.userId === data.fromUserId)
    if (existingPeer) {
      console.log('Peer already exists for', data.fromUsername, ', ignoring offer')
      return
    }

    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream: localStream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    })

    peer.on('signal', (signal) => {
      console.log('Sending signal:', signal.type, 'to', data.fromUsername)
      if (signal.type === 'answer') {
        socketService.sendAnswer({ targetUserId: data.fromUserId, answer: signal })
      } else {
        // ICE candidates
        socketService.sendIceCandidate({ targetUserId: data.fromUserId, candidate: signal })
      }
    })

    peer.on('stream', (remoteStream) => {
      console.log('Received remote stream from:', data.fromUsername)
      setPeers(prevPeers => {
        const updatedPeers = prevPeers.map(p =>
          p.userId === data.fromUserId
            ? { ...p, stream: remoteStream }
            : p
        )
        peersRef.current = updatedPeers
        return updatedPeers
      })

      setConnectionStates(prev => ({
        ...prev,
        [data.fromUserId]: 'connected'
      }))
    })

    peer.on('connect', () => {
      console.log('Peer connected:', data.fromUsername)
    })

    peer.on('error', (err) => {
      console.error('Peer error:', err)
      setConnectionStates(prev => ({
        ...prev,
        [data.fromUserId]: 'failed'
      }))
    })

    peer.on('close', () => {
      console.log('Peer connection closed:', data.fromUsername)
      removePeer(data.fromUserId)
    })

    // Signal the offer
    peer.signal(data.offer)

    const peerConnection: PeerConnection = {
      peerId: data.fromUserId,
      peer,
      userId: data.fromUserId,
      username: data.fromUsername,
      firstName: data.fromUsername, // Fallback
      lastName: '',
      role: 'attendee'
    }

    peersRef.current.push(peerConnection)
    setPeers(prevPeers => [...prevPeers, peerConnection])

    setConnectionStates(prev => ({
      ...prev,
      [data.fromUserId]: 'connecting'
    }))
  }, [localStream, removePeer])

  // Handle incoming answer
  const handleAnswer = useCallback((data: { fromUserId: string; fromUsername: string; answer: any }) => {
    const peerConnection = peersRef.current.find(p => p.userId === data.fromUserId)
    if (peerConnection) {
      console.log('Received answer from:', data.fromUsername)
      try {
        peerConnection.peer.signal(data.answer)
      } catch (error) {
        console.error('Error handling answer:', error)
      }
    } else {
      console.error('No peer found for answer from:', data.fromUserId)
    }
  }, [])

  // Handle ICE candidate
  const handleIceCandidate = useCallback((data: { fromUserId: string; candidate: any }) => {
    const peerConnection = peersRef.current.find(p => p.userId === data.fromUserId)
    if (peerConnection) {
      console.log('Received ICE candidate from:', data.fromUserId)
      try {
        peerConnection.peer.signal(data.candidate)
      } catch (error) {
        console.error('Error handling ICE candidate:', error)
      }
    } else {
      console.error('No peer found for ICE candidate from:', data.fromUserId)
    }
  }, [])

  // Initialize WebRTC when joining room
  const initializeWebRTC = useCallback((participants: Participant[], stream: MediaStream) => {
    if (!stream || isInitialized.current) {
      console.log('WebRTC already initialized or no stream available')
      return
    }

    console.log('=== INITIALIZING WEBRTC ===')
    console.log('Participants:', participants.length)
    console.log('Stream:', !!stream)

    isInitialized.current = true

    // Create peer connections for existing participants
    // The current user initiates connections to participants who joined before them
    participants.forEach(participant => {
      if (participant.userId !== userId) {
        console.log('Creating peer connection for:', participant.firstName, participant.lastName)
        createPeer(
          participant.userId, 
          participant.username, 
          participant,
          stream, 
          true // This user initiates the connection
        )
      }
    })

    console.log('WebRTC initialization complete')
  }, [userId, createPeer])

  // Handle new participant joining
  const handleParticipantJoined = useCallback((data: { user: Participant }, stream: MediaStream) => {
    console.log('=== HANDLING NEW PARTICIPANT ===')
    console.log('New participant:', data.user.firstName, data.user.lastName)
    
    if (data.user.userId !== userId && stream) {
      // For new participants joining, they will initiate the connection to existing users
      // So we don't create a peer here - we wait for their offer
      console.log('Waiting for offer from new participant:', data.user.firstName)
    }
  }, [userId])

  // Handle participant leaving
  const handleParticipantLeft = useCallback((data: { userId: string }) => {
    console.log('=== HANDLING PARTICIPANT LEFT ===')
    console.log('Participant left:', data.userId)
    removePeer(data.userId)
  }, [removePeer])

  // Update local stream for all peers
  const updateLocalStream = useCallback((newStream: MediaStream) => {
    console.log('Updating local stream for all peers')
    peersRef.current.forEach(peerConnection => {
      try {
        const videoTrack = newStream.getVideoTracks()[0]
        const audioTrack = newStream.getAudioTracks()[0]

        // Access the underlying RTCPeerConnection
        const peerInstance = peerConnection.peer as any
        const rtcPeerConnection = peerInstance._pc as RTCPeerConnection

        if (rtcPeerConnection) {
          // Replace video track
          if (videoTrack) {
            const videoSender = rtcPeerConnection.getSenders().find((s: RTCRtpSender) => 
              s.track?.kind === 'video'
            )
            if (videoSender) {
              videoSender.replaceTrack(videoTrack).catch(console.error)
            }
          }

          // Replace audio track
          if (audioTrack) {
            const audioSender = rtcPeerConnection.getSenders().find((s: RTCRtpSender) => 
              s.track?.kind === 'audio'
            )
            if (audioSender) {
              audioSender.replaceTrack(audioTrack).catch(console.error)
            }
          }
        }
      } catch (error) {
        console.error('Error updating stream for peer:', peerConnection.username, error)
      }
    })
  }, [])

  // Cleanup
  const cleanup = useCallback(() => {
    console.log('=== WEBRTC CLEANUP ===')
    isInitialized.current = false
    
    peersRef.current.forEach(peerConnection => {
      try {
        peerConnection.peer.destroy()
      } catch (error) {
        console.error('Error destroying peer during cleanup:', error)
      }
    })
    
    peersRef.current = []
    setPeers([])
    setConnectionStates({})
    
    console.log('WebRTC cleanup complete')
  }, [])

  // Set up socket listeners for WebRTC signaling
  useEffect(() => {
    console.log('Setting up WebRTC socket listeners')

    const onOffer = (data: any) => {
      console.log('Socket: Received offer event')
      handleOffer(data)
    }

    const onAnswer = (data: any) => {
      console.log('Socket: Received answer event')
      handleAnswer(data)
    }

    const onIceCandidate = (data: any) => {
      console.log('Socket: Received ice-candidate event')
      handleIceCandidate(data)
    }

    // Register socket listeners
    socketService.onOffer(onOffer)
    socketService.onAnswer(onAnswer)
    socketService.onIceCandidate(onIceCandidate)

    return () => {
      console.log('Cleaning up WebRTC socket listeners')
      // Note: socketService.removeAllListeners() would remove ALL listeners
      // We should ideally have individual remove functions
    }
  }, [handleOffer, handleAnswer, handleIceCandidate])

  // Update peer states when participants change
  const updatePeerStates = useCallback((participantUpdates: { userId: string; [key: string]: any }) => {
    setPeers(prevPeers => {
      const updatedPeers = prevPeers.map(peer => 
        peer.userId === participantUpdates.userId 
          ? { ...peer, ...participantUpdates }
          : peer
      )
      peersRef.current = updatedPeers
      return updatedPeers
    })
  }, [])

  return {
    peers,
    connectionStates,
    initializeWebRTC,
    handleParticipantJoined,
    handleParticipantLeft,
    updateLocalStream,
    updatePeerStates,
    cleanup
  }
}