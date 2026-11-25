(function () {
    'use strict';

    const activeConnections = new Set();

    function createAudioElement(track) {
        const audio = track.attach();

        audio.autoplay = true;
        audio.setAttribute('playsinline', '');
        audio.style.display = 'none';

        document.body.appendChild(audio);

        audio.play().catch((error) => {
            console.warn(
                '[LIVEKIT] Audio playback menunggu interaksi pengguna:',
                error.message
            );
        });

        return audio;
    }

    /**
     * Memaksa pelepasan penuh hardware mikrofon dari LiveKit LocalParticipant
     * agar tidak mengunci perangkat audio saat beralih ke Speech-to-Text.
     */
    async function releaseLocalMicrophone(room, Track) {
        if (!room || !room.localParticipant) return;

        try {
            await room.localParticipant.setMicrophoneEnabled(false);
        } catch (e) {
            console.warn('[LIVEKIT] Gagal setMicrophoneEnabled(false):', e);
        }

        // Unpublish dan paksa stop() pada setiap track audio lokal
        const publications = Array.from(
            room.localParticipant.audioTrackPublications.values()
        );

        for (const pub of publications) {
            const track = pub.track;
            if (track) {
                try {
                    await room.localParticipant.unpublishTrack(track, true);
                } catch (_) {}

                try {
                    track.stop();
                } catch (_) {}

                if (track.mediaStreamTrack) {
                    try {
                        track.mediaStreamTrack.stop();
                    } catch (_) {}
                }
            }
        }
    }

    async function connect(options) {
        const {
            url,
            token,
            canPublish = false,
            onStatus = () => {},
            onSpeaking = () => {}
        } = options || {};

        if (!window.LivekitClient) {
            throw new Error(
                'LiveKit SDK belum dimuat. Periksa script CDN.'
            );
        }

        if (!url || !token) {
            throw new Error(
                'LiveKit URL atau token tidak tersedia.'
            );
        }

        const {
            Room,
            RoomEvent,
            Track
        } = window.LivekitClient;

        const room = new Room({
            adaptiveStream: false,
            dynacast: false,
            stopLocalTrackOnUnpublish: true
        });

        const audioElements = new Map();

        let connected = false;
        let disconnected = false;

        function removeAudio(track) {
            const audio = audioElements.get(track.sid);

            if (audio) {
                track.detach(audio);
                audio.remove();
                audioElements.delete(track.sid);
            } else {
                track.detach();
            }
        }

        room.on(
            RoomEvent.TrackSubscribed,
            (track, publication, participant) => {
                if (track.kind !== Track.Kind.Audio) {
                    return;
                }

                const audio = createAudioElement(track);

                audioElements.set(track.sid, audio);

                console.log(
                    '[LIVEKIT] Audio diterima:',
                    participant.identity
                );
            }
        );

        room.on(
            RoomEvent.TrackUnsubscribed,
            (track) => {
                removeAudio(track);
            }
        );

        room.on(
            RoomEvent.ActiveSpeakersChanged,
            (speakers) => {
                onSpeaking(
                    speakers.map((participant) => ({
                        identity: participant.identity,
                        name: participant.name
                    }))
                );
            }
        );

        room.on(RoomEvent.Disconnected, () => {
            connected = false;
            disconnected = true;

            onStatus('Koneksi LiveKit terputus.');
        });

        room.on(
            RoomEvent.ConnectionStateChanged,
            (state) => {
                onStatus('Status LiveKit: ' + state);
            }
        );

        try {
            onStatus('Menghubungkan ke LiveKit...');

            await room.connect(url, token);

            connected = true;

            const connection = {
                room,

                async setMicrophoneEnabled(enabled) {
                    if (!canPublish) {
                        throw new Error(
                            'Koneksi ini tidak memiliki izin mengirim suara.'
                        );
                    }

                    if (!connected || disconnected) {
                        throw new Error(
                            'Koneksi LiveKit belum aktif.'
                        );
                    }

                    if (Boolean(enabled)) {
                        await room.localParticipant.setMicrophoneEnabled(true);
                        onStatus('Mikrofon aktif.');
                    } else {
                        await releaseLocalMicrophone(room, Track);
                        onStatus('Mikrofon nonaktif.');
                    }
                },

                async disconnect() {
                    if (disconnected) return;

                    disconnected = true;
                    connected = false;

                    try {
                        await releaseLocalMicrophone(room, Track);
                        await room.disconnect();
                    } finally {
                        audioElements.forEach((audio) => {
                            audio.pause();
                            audio.remove();
                        });

                        audioElements.clear();
                        activeConnections.delete(connection);

                        onStatus('Koneksi LiveKit ditutup.');
                    }
                }
            };

            activeConnections.add(connection);

            onStatus('Terhubung ke LiveKit.');

            return connection;

        } catch (error) {
            connected = false;
            disconnected = true;

            try {
                await releaseLocalMicrophone(room, Track);
                await room.disconnect();
            } catch (_) {}

            onStatus('Gagal terhubung ke LiveKit.');

            throw error;
        }
    }

    async function disconnectAll() {
        const connections = Array.from(activeConnections);

        await Promise.all(
            connections.map((connection) =>
                connection.disconnect()
            )
        );
    }

    window.TacticalVoice = {
        connect,
        disconnectAll
    };

    console.log('[TACTICAL VOICE] Voice module siap.');
})();