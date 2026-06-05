import { io } from 'socket.io-client';

const API_URL = 'https://prospector-ai-production-94fe.up.railway.app';
const socket = io(API_URL, { reconnectionDelay: 1000, reconnectionDelayMax: 5000, transports: ['websocket', 'polling'] });
export default socket;
