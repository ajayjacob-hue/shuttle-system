import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from './config';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
    const [socket, setSocket] = useState(null);

    useEffect(() => {
        const serverUrl = API_URL;
        // console.log('Connecting to Socket URL:', serverUrl);
        const newSocket = io(serverUrl, {
            pingInterval: 5000,
            pingTimeout: 10000,
            reconnection: true,
            reconnectionAttempts: Infinity
        });
        setSocket(newSocket);

        return () => newSocket.close();
    }, []);

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
};
