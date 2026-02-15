const { io } = require('socket.io-client');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Test Driver Connected:', socket.id);

    socket.emit('join_role', 'driver');

    // Simulate location updates
    console.log('Sending location...');
    socket.emit('update_location', {
        driverId: 'TEST-BUS',
        lat: 12.9692,
        lng: 79.1559
    });

    setTimeout(() => {
        console.log('Sending stop_sharing...');
        socket.emit('stop_sharing');
    }, 2000);

    setTimeout(() => {
        console.log('Disconnecting...');
        socket.disconnect();
    }, 4000);
});
