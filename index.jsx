import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  query,
  where,
  addDoc,
  getDocs,
} from 'firebase/firestore';

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Image URLs for money notes (using provided filenames as placeholders)
const moneyNotes = {
  10: 'image_2ef7b4.png',
  50: 'image_2ef3f4.png',
  100: 'image_2ef3d5.png',
  200: 'https://placehold.co/200x100/A0522D/ffffff?text=200', // Placeholder
  500: 'image_2ef37d.png',
  1000: 'image_2ef375.png',
  2000: 'image_2ef356.png',
  10000: 'image_2ea1d8.png',
};

// Board image
const boardImage = 'image_2e9dfe.png'; // Using the provided board design image

// Player colors for the game
const playerColors = [
  '#FF0000', // Red (Player 1)
  '#FFFF00', // Yellow (Player 2)
  '#0000FF', // Blue (Player 3)
  '#008000', // Green (Player 4)
  '#FFA500', // Orange (Player 5) - Added for 5th player logic
];

// Initial game settings
const STARTING_MONEY = 5000;
const BANK_AMOUNT_PER_CORRECT_ANSWER = 500;
const BANK_PENALTY_PER_INCORRECT_ANSWER = 200;
const PROPERTY_COST = 1000;
const RENT_AMOUNT = 300;

// Utility for generating random equations
const generateEquation = () => {
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = Math.floor(Math.random() * 10) + 1;
  const operator = ['+', '-', '*', '/'][Math.floor(Math.random() * 4)];
  let equationStr;
  let answer;

  switch (operator) {
    case '+':
      equationStr = `${num1} + ${num2}`;
      answer = num1 + num2;
      break;
    case '-':
      equationStr = `${num1} - ${num2}`;
      answer = num1 - num2;
      break;
    case '*':
      equationStr = `${num1} * ${num2}`;
      answer = num1 * num2;
      break;
    case '/':
      // Ensure integer answers for division, regenerate if not
      if (num1 % num2 !== 0) {
        return generateEquation(); // Recurse to get integer answer
      }
      equationStr = `${num1} / ${num2}`;
      answer = num1 / num2;
      break;
    default:
      return generateEquation(); // Should not happen, but safe fallback
  }
  return { equation: equationStr, answer: answer };
};

// Custom Modal Component
const Modal = ({ isOpen, title, children, onClose, buttons }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-purple-700 to-indigo-900 p-8 rounded-xl shadow-2xl border-2 border-purple-400 max-w-lg w-full text-white animate-fade-in">
        <h3 className="text-3xl font-extrabold mb-6 text-center text-purple-200 drop-shadow-lg">{title}</h3>
        <div className="mb-6 text-lg text-gray-100 leading-relaxed overflow-y-auto max-h-96">{children}</div>
        <div className="flex justify-center space-x-4">
          {buttons.map((button, index) => (
            <button
              key={index}
              onClick={button.onClick}
              className={`px-6 py-3 rounded-full text-lg font-semibold transition-all duration-300 transform hover:scale-105 shadow-lg ${button.className}`}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};


// Main App Component
const App = () => {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [currentPage, setCurrentPage] = useState('login'); // 'login', 'lobby', 'game'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [currentGame, setCurrentGame] = useState(null);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [modal, setModal] = useState({ isOpen: false, title: '', content: '', buttons: [] });
  const [playerRewards, setPlayerRewards] = useState([]);
  const [diceRolling, setDiceRolling] = useState(false);
  const [diceResult, setDiceResult] = useState(1);
  const [userProfile, setUserProfile] = useState(null); // Store user profile from Firestore
  const [llmLoading, setLlmLoading] = useState(false); // State for LLM loading

  // Firestore DB and Auth instances
  const dbRef = useRef(null);
  const authRef = useRef(null);
  const userIdRef = useRef(null); // Stores the current user's ID

  // Function to call Gemini API
  const callGeminiApi = async (promptText) => {
    setLlmLoading(true);
    try {
      let chatHistory = [];
      chatHistory.push({ role: "user", parts: [{ text: promptText }] });
      const payload = { contents: chatHistory };
      const apiKey = ""; // If you want to use models other than gemini-2.0-flash or imagen-3.0-generate-002, provide an API key here. Otherwise, leave this as-is.
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        setLlmLoading(false);
        return text;
      } else {
        setLlmLoading(false);
        console.error("Gemini API response structure unexpected:", result);
        return "Could not generate response.";
      }
    } catch (error) {
      setLlmLoading(false);
      console.error("Error calling Gemini API:", error);
      return "Failed to connect to the AI. Please try again.";
    }
  };


  // Function to show custom alert modal
  const showAlert = useCallback((title, content, type = 'info', onConfirm = null) => {
    let buttonClass = 'bg-blue-600 hover:bg-blue-700';
    if (type === 'error') buttonClass = 'bg-red-600 hover:bg-red-700';
    if (type === 'success') buttonClass = 'bg-green-600 hover:bg-green-700';

    setModal({
      isOpen: true,
      title: title,
      content: content,
      buttons: [
        {
          label: 'OK',
          onClick: () => {
            setModal({ ...modal, isOpen: false });
            if (onConfirm) onConfirm();
          },
          className: buttonClass,
        },
      ],
    });
  }, [modal]); // Dependency on modal to ensure it's up-to-date

  // Function to show custom confirmation modal
  const showConfirm = useCallback((title, content, onConfirm, onCancel) => {
    setModal({
      isOpen: true,
      title: title,
      content: content,
      buttons: [
        {
          label: 'Confirm',
          onClick: () => {
            setModal({ ...modal, isOpen: false });
            onConfirm();
          },
          className: 'bg-green-600 hover:bg-green-700',
        },
        {
          label: 'Cancel',
          onClick: () => {
            setModal({ ...modal, isOpen: false });
            if (onCancel) onCancel();
          },
          className: 'bg-gray-600 hover:bg-gray-700',
        },
      ],
    });
  }, [modal]); // Dependency on modal to ensure it's up-to-date


  // Initialize Firebase and set up auth state listener
  useEffect(() => {
    dbRef.current = db;
    authRef.current = auth;

    // Authenticate with custom token if available, otherwise sign in anonymously
    const authenticateFirebase = async () => {
      try {
        if (initialAuthToken) {
          await signInWithCustomToken(authRef.current, initialAuthToken);
        } else {
          await signInAnonymously(authRef.current);
        }
        console.log("Firebase authenticated.");
      } catch (e) {
        console.error("Firebase authentication error:", e);
        setError("Failed to authenticate with Firebase.");
      } finally {
        setLoadingAuth(false);
      }
    };

    authenticateFirebase();

    // Set up auth state change listener
    const unsubscribe = onAuthStateChanged(authRef.current, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        userIdRef.current = currentUser.uid;
        console.log("User UID:", currentUser.uid);
        // Fetch user profile from Firestore
        const userDocRef = doc(dbRef.current, 'artifacts', appId, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          setUserProfile(userDocSnap.data());
          setCurrentPage('lobby'); // Go to lobby if logged in and profile exists
        } else {
          // If no profile, maybe they just registered, prompt for username
          setUserProfile(null);
          setCurrentPage('register'); // Go to register page if no profile exists
        }
      } else {
        userIdRef.current = null;
        setUserProfile(null);
        setCurrentPage('login'); // Go to login if not authenticated
      }
      setIsAuthReady(true); // Firebase auth state is ready
    });

    return () => unsubscribe(); // Cleanup auth listener
  }, []);

  // --- Auth Functions ---
  const handleRegister = async () => {
    setError('');
    if (!email || !password || !username) {
      showAlert('Error', 'Please fill in all fields.', 'error');
      return;
    }
    try {
      setLoadingAuth(true);
      const userCredential = await createUserWithEmailAndPassword(authRef.current, email, password);
      const user = userCredential.user;

      // Save user profile to Firestore
      const userDocRef = doc(dbRef.current, 'artifacts', appId, 'users', user.uid);
      await setDoc(userDocRef, {
        username: username,
        email: user.email,
        createdAt: new Date(),
        currentRoomId: null,
        rewards: [], // Initialize rewards
      });
      showAlert('Success', 'Account created and profile saved successfully!', 'success');
      setUser(user);
      setUserProfile({ username, email: user.email, currentRoomId: null, rewards: [] });
      setCurrentPage('lobby');
    } catch (e) {
      console.error("Registration error:", e);
      setError(e.message);
      showAlert('Error', `Registration failed: ${e.message}`, 'error');
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleLogin = async () => {
    setError('');
    if (!email || !password) {
      showAlert('Error', 'Please enter email and password.', 'error');
      return;
    }
    try {
      setLoadingAuth(true);
      const userCredential = await signInWithEmailAndPassword(authRef.current, email, password);
      const user = userCredential.user;

      const userDocRef = doc(dbRef.current, 'artifacts', appId, 'users', user.uid);
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        setUserProfile(userDocSnap.data());
        showAlert('Success', 'Logged in successfully!', 'success');
        setCurrentPage('lobby');
      } else {
        showAlert('Error', 'User profile not found. Please register or contact support.', 'error');
        await signOut(authRef.current); // Log out if profile is missing
      }
    } catch (e) {
      console.error("Login error:", e);
      setError(e.message);
      showAlert('Error', `Login failed: ${e.message}`, 'error');
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (user && userProfile && userProfile.currentRoomId) {
        // If user is in a game, leave it before logging out
        await leaveGame(userProfile.currentRoomId);
      }
      await signOut(authRef.current);
      setUser(null);
      setUserProfile(null);
      setCurrentPage('login');
      showAlert('Logged out', 'You have been successfully logged out.', 'info');
    } catch (e) {
      console.error("Logout error:", e);
      showAlert('Error', `Logout failed: ${e.message}`, 'error');
    }
  };

  const handleDeleteAccount = async () => {
    showConfirm('Delete Account', 'Are you sure you want to delete your account? This action is irreversible.',
      async () => {
        try {
          if (user && userProfile && userProfile.currentRoomId) {
            await leaveGame(userProfile.currentRoomId); // Leave game first
          }
          await deleteDoc(doc(dbRef.current, 'artifacts', appId, 'users', user.uid));
          await deleteUser(user);
          setUser(null);
          setUserProfile(null);
          setCurrentPage('login');
          showAlert('Account Deleted', 'Your account has been successfully deleted.', 'success');
        } catch (e) {
          console.error("Delete account error:", e);
          showAlert('Error', `Failed to delete account: ${e.message}`, 'error');
        }
      }
    );
  };

  // --- Game Room Functions ---

  // Fetches available game rooms
  useEffect(() => {
    if (!isAuthReady || currentPage !== 'lobby' || !dbRef.current) return;

    const roomsCollectionRef = collection(dbRef.current, 'artifacts', appId, 'public', 'data', 'games');
    const q = query(roomsCollectionRef, where('status', '==', 'waiting'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rooms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAvailableRooms(rooms);
    }, (error) => {
      console.error("Error fetching available rooms:", error);
      showAlert('Error', 'Failed to fetch available game rooms.', 'error');
    });

    return () => unsubscribe();
  }, [isAuthReady, currentPage, showAlert]);


  const createGame = async () => {
    if (!user || !userProfile || !dbRef.current) {
      showAlert('Error', 'You must be logged in to create a game.', 'error');
      return;
    }

    try {
      const newGameRef = doc(collection(dbRef.current, 'artifacts', appId, 'public', 'data', 'games'));
      const initialPlayer = {
        userId: user.uid,
        username: userProfile.username,
        color: playerColors[0], // Creator gets first color by default
        money: STARTING_MONEY,
        propertyCount: 0,
        position: 0,
      };

      await setDoc(newGameRef, {
        players: [initialPlayer],
        currentPlayerId: user.uid, // Creator is first player
        status: 'waiting', // Waiting for more players
        boardState: {}, // Stores property owners: { 'squareId': { ownerId: 'userId', rent: amount } }
        turnCount: 0,
        bankMoney: 100000, // Initial bank money
        equations: {}, // { colorIndex: { equation: '2+2', answer: 4 } }
        invitations: [], // To store pending invitations
      });
      setCurrentRoomId(newGameRef.id);
      await updateDoc(doc(dbRef.current, 'artifacts', appId, 'users', user.uid), {
        currentRoomId: newGameRef.id,
      });
      showAlert('Game Created!', `Game ID: ${newGameRef.id}. Share this ID to invite players.`, 'success');
      setCurrentPage('game'); // Move to game screen immediately
    } catch (e) {
      console.error("Error creating game:", e);
      showAlert('Error', `Failed to create game: ${e.message}`, 'error');
    }
  };

  const joinGame = async (gameId) => {
    if (!user || !userProfile || !dbRef.current) {
      showAlert('Error', 'You must be logged in to join a game.', 'error');
      return;
    }
    try {
      const gameRef = doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', gameId);
      const gameSnap = await getDoc(gameRef);

      if (!gameSnap.exists()) {
        showAlert('Error', 'Game not found.', 'error');
        return;
      }

      const gameData = gameSnap.data();

      if (gameData.status !== 'waiting') {
        showAlert('Error', 'This game is already in progress or finished.', 'error');
        return;
      }
      if (gameData.players.length >= 5) {
        showAlert('Error', 'This game is full (max 5 players).', 'error');
        return;
      }
      if (gameData.players.some(p => p.userId === user.uid)) {
        showAlert('Info', 'You are already in this game.', 'info');
        setCurrentRoomId(gameId);
        setCurrentPage('game');
        return;
      }

      // Assign a color not already taken
      const assignedColor = playerColors.find(
        color => !gameData.players.some(p => p.color === color)
      );

      if (!assignedColor) {
        showAlert('Error', 'No available colors in this game. This should not happen.', 'error');
        return;
      }

      const newPlayer = {
        userId: user.uid,
        username: userProfile.username,
        color: assignedColor,
        money: STARTING_MONEY,
        propertyCount: 0,
        position: 0,
      };

      const updatedPlayers = [...gameData.players, newPlayer];
      await updateDoc(gameRef, { players: updatedPlayers });
      setCurrentRoomId(gameId);
      await updateDoc(doc(dbRef.current, 'artifacts', appId, 'users', user.uid), {
        currentRoomId: gameId,
      });
      showAlert('Success', `Joined game: ${gameId}`, 'success');
      setCurrentPage('game'); // Move to game screen
    } catch (e) {
      console.error("Error joining game:", e);
      showAlert('Error', `Failed to join game: ${e.message}`, 'error');
    }
  };

  const leaveGame = async (gameId) => {
    if (!user || !userProfile || !dbRef.current || !gameId) return;

    try {
      const gameRef = doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', gameId);
      const gameSnap = await getDoc(gameRef);

      if (gameSnap.exists()) {
        const gameData = gameSnap.data();
        const updatedPlayers = gameData.players.filter(p => p.userId !== user.uid);

        if (updatedPlayers.length === 0) {
          // If no players left, delete the game
          await deleteDoc(gameRef);
          console.log(`Game ${gameId} deleted as no players left.`);
        } else {
          // If game is in progress, handle current player leaving (e.g., assign next player)
          let newCurrentPlayerId = gameData.currentPlayerId;
          if (gameData.currentPlayerId === user.uid && updatedPlayers.length > 0) {
            const currentPlayersIndex = gameData.players.findIndex(p => p.userId === user.uid);
            const nextPlayerIndex = (currentPlayersIndex + 1) % gameData.players.length;
            newCurrentPlayerId = updatedPlayers[nextPlayerIndex]?.userId || updatedPlayers[0].userId; // Assign to first remaining player
          }
          await updateDoc(gameRef, { players: updatedPlayers, currentPlayerId: newCurrentPlayerId });
          console.log(`User ${user.uid} left game ${gameId}.`);
        }
      }

      await updateDoc(doc(dbRef.current, 'artifacts', appId, 'users', user.uid), {
        currentRoomId: null,
      });
      setCurrentRoomId(null);
      setCurrentGame(null);
      setCurrentPage('lobby');
      showAlert('Game Left', 'You have successfully left the game.', 'info');
    } catch (e) {
      console.error("Error leaving game:", e);
      showAlert('Error', `Failed to leave game: ${e.message}`, 'error');
    }
  };


  // Listen for game state changes
  useEffect(() => {
    if (!currentRoomId || !dbRef.current || !isAuthReady) return;

    const gameRef = doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', currentRoomId);
    const unsubscribe = onSnapshot(gameRef, (docSnap) => {
      if (docSnap.exists()) {
        const gameData = docSnap.data();
        setCurrentGame(gameData);

        // Update user's currentRoomId if it was cleared externally
        if (userProfile && userProfile.currentRoomId !== currentRoomId) {
          updateDoc(doc(dbRef.current, 'artifacts', appId, 'users', user.uid), {
            currentRoomId: currentRoomId,
          }).catch(e => console.error("Error updating user currentRoomId:", e));
        }

        // Start game if 2 players and status is waiting
        if (gameData.players.length >= 2 && gameData.status === 'waiting') {
          updateDoc(gameRef, { status: 'in-progress' })
            .catch(e => console.error("Error starting game:", e));
        }
      } else {
        // Game no longer exists (e.g., host left, or deleted)
        showAlert('Game Ended', 'The game you were in has ended or been disbanded.', 'info', () => {
          setCurrentRoomId(null);
          setCurrentGame(null);
          setCurrentPage('lobby');
        });
        if (user && userProfile && userProfile.currentRoomId) {
          updateDoc(doc(dbRef.current, 'artifacts', appId, 'users', user.uid), {
            currentRoomId: null,
          }).catch(e => console.error("Error clearing user currentRoomId:", e));
        }
      }
    }, (error) => {
      console.error("Error listening to game state:", error);
      showAlert('Error', 'Failed to synchronize game state.', 'error');
    });

    return () => unsubscribe();
  }, [currentRoomId, isAuthReady, user, userProfile, showAlert]);


  // Update user profile rewards
  useEffect(() => {
    if (!user || !userProfile || !dbRef.current) return;
    const userDocRef = doc(dbRef.current, 'artifacts', appId, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setPlayerRewards(docSnap.data().rewards || []);
        setUserProfile(docSnap.data()); // Keep userProfile updated
      }
    }, (error) => {
      console.error("Error listening to user rewards:", error);
    });
    return () => unsubscribe();
  }, [user, userProfile]);


  // --- Game Logic Functions ---

  const getPlayerByUserId = (userId) => currentGame?.players.find(p => p.userId === userId);
  const getCurrentPlayer = () => currentGame?.players.find(p => p.userId === currentGame.currentPlayerId);
  const isMyTurn = user && currentGame && currentGame.currentPlayerId === user.uid;

  const rollDice = async () => {
    if (!isMyTurn || diceRolling || !dbRef.current || !currentRoomId) return;

    setDiceRolling(true);
    const roll = Math.floor(Math.random() * 6) + 1; // 1 to 6
    setDiceResult(roll);

    // Simulate dice animation
    let animationCounter = 0;
    const interval = setInterval(() => {
      setDiceResult(Math.floor(Math.random() * 6) + 1);
      animationCounter++;
      if (animationCounter > 10) { // Spin for a bit
        clearInterval(interval);
        setDiceResult(roll); // Set final result
        setTimeout(async () => {
          setDiceRolling(false);
          await movePlayer(roll);
        }, 500); // Small delay before moving
      }
    }, 100);
  };

  const boardSize = 20; // Example board size, based on your image having numbers up to 5 on each side
  const movePlayer = async (steps) => {
    const gameRef = doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', currentRoomId);
    if (!currentGame || !user || !dbRef.current) return;

    const currentPlayer = getPlayerByUserId(user.uid);
    if (!currentPlayer) return;

    let newPosition = (currentPlayer.position + steps) % boardSize;
    if (newPosition < 0) newPosition += boardSize; // Handle negative if logic changes

    const updatedPlayers = currentGame.players.map(p =>
      p.userId === user.uid ? { ...p, position: newPosition } : p
    );

    await updateDoc(gameRef, { players: updatedPlayers });

    // Determine what happens on the new square
    // For simplicity, let's say squares 0-4 are P1's colors, 5-9 P2's, etc.
    // This is a simplification; a real board would map positions to colors.
    const squareColorIndex = newPosition % 5; // Simplified mapping for example

    const landedPlayer = getPlayerByUserId(user.uid);
    if (!landedPlayer) return; // Should not happen

    const landedOnPlayerColor = currentGame.players.find(p =>
      playerColors.indexOf(p.color) === squareColorIndex && p.userId !== landedPlayer.userId
    );

    const landedOnOwnColor = playerColors.indexOf(landedPlayer.color) === squareColorIndex;


    if (landedOnOwnColor) {
      // Landed on own color: Build property or safe zone
      if (!currentGame.boardState[`square-${newPosition}`]) {
        showConfirm(
          'Build Property',
          `You landed on your own color! Do you want to build a property on square ${newPosition} for $${PROPERTY_COST}? This will allow you to collect rent from other players.`,
          async () => {
            if (landedPlayer.money >= PROPERTY_COST) {
              const updatedMoney = landedPlayer.money - PROPERTY_COST;
              const updatedPropertyCount = landedPlayer.propertyCount + 1;
              const updatedPlayersAfterBuild = currentGame.players.map(p =>
                p.userId === user.uid ? { ...p, money: updatedMoney, propertyCount: updatedPropertyCount } : p
              );
              const updatedBoardState = {
                ...currentGame.boardState,
                [`square-${newPosition}`]: { ownerId: user.uid, rent: RENT_AMOUNT }
              };
              await updateDoc(gameRef, {
                players: updatedPlayersAfterBuild,
                boardState: updatedBoardState
              });
              showAlert('Property Built!', `You built a property on square ${newPosition}!`, 'success');
              await endTurn();
            } else {
              showAlert('Cannot Build', 'You do not have enough money to build a property.', 'error');
              await endTurn(); // Still end turn
            }
          },
          async () => {
            showAlert('Action Skipped', 'You chose not to build property.', 'info');
            await endTurn(); // End turn
          }
        );
      } else {
        // Already built, just a safe zone
        showAlert('Safe Zone', `You landed on your own property (square ${newPosition})! Safe zone.`, 'info');
        await endTurn();
      }
    } else if (landedOnPlayerColor && currentGame.boardState[`square-${newPosition}`]?.ownerId === landedOnPlayerColor.userId) {
      // Landed on another player's color with property
      const owner = landedOnPlayerColor;
      const rent = currentGame.boardState[`square-${newPosition}`].rent;
      showAlert('Rent!', `You landed on ${owner.username}'s property (square ${newPosition}). You owe them $${rent}.`);

      // Deduct from current player, add to owner
      const updatedPlayersAfterRent = currentGame.players.map(p => {
        if (p.userId === landedPlayer.userId) return { ...p, money: Math.max(0, p.money - rent) };
        if (p.userId === owner.userId) return { ...p, money: p.money + rent };
        return p;
      });
      await updateDoc(gameRef, { players: updatedPlayersAfterRent });
      await promptEquationAndEndTurn(newPosition);
    } else if (landedOnPlayerColor && !currentGame.boardState[`square-${newPosition}`]) {
      // Landed on another player's color, no property yet
      showAlert('Equation Challenge!', `You landed on ${landedOnPlayerColor.username}'s color (square ${newPosition}). Prepare for an equation challenge!`);
      await promptEquationAndEndTurn(newPosition);
    } else {
      // Landed on a safe zone (unused color or empty square)
      showAlert('Safe Zone', `You landed on a safe zone (square ${newPosition}). No action needed.`, 'info');
      await endTurn();
    }
  };


  const promptEquationAndEndTurn = async (squarePosition) => {
    if (!currentGame || !user || !dbRef.current) return;
    const gameRef = doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', currentRoomId);
    const currentPlayer = getPlayerByUserId(user.uid);
    if (!currentPlayer) return;

    // Get the owner of the square's color (the one who provides the equation)
    const squareColorIndex = squarePosition % 5; // Simplified mapping
    const ownerPlayer = currentGame.players.find(p => playerColors.indexOf(p.color) === squareColorIndex);

    let equationToSolve;
    let actualAnswer;

    if (ownerPlayer && ownerPlayer.userId === user.uid) {
        // This case should be handled by 'landedOnOwnColor'
        // But as a fallback, if somehow reaches here for own color, act as safe zone.
        showAlert('Safe Zone', 'You landed on your own color, no equation to solve.', 'info');
        await endTurn();
        return;
    } else if (ownerPlayer) {
        // If an owner player exists, check if they have a predefined equation for this color
        // For dynamic equations, we'd prompt the owner to create one here.
        // For this demo, we'll generate one
        const { equation, answer } = generateEquation();
        equationToSolve = equation;
        actualAnswer = answer;
    } else {
        // Safe zone if no player owns this color (e.g., less than 5 players)
        showAlert('Safe Zone', 'You landed on an unassigned color. Safe zone.', 'info');
        await endTurn();
        return;
    }

    let userAnswer = '';
    setModal({
      isOpen: true,
      title: 'Equation Challenge!',
      content: (
        <div className="flex flex-col items-center space-y-4">
          <p className="text-2xl font-bold text-yellow-300">Equation: {equationToSolve}</p>
          <input
            type="number"
            className="w-full p-3 rounded-lg bg-gray-800 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500"
            placeholder="Enter your answer"
            onChange={(e) => (userAnswer = e.target.value)}
          />
          {llmLoading && <p className="text-blue-300">Generating hint...</p>}
        </div>
      ),
      buttons: [
        {
          label: 'Submit Answer',
          onClick: async () => {
            setModal({ ...modal, isOpen: false });
            const parsedAnswer = parseFloat(userAnswer);

            let updatedPlayers = [...currentGame.players];
            let bankMoney = currentGame.bankMoney;
            let rewardEarned = false;

            if (!isNaN(parsedAnswer) && parsedAnswer === actualAnswer) {
              showAlert('Correct!', 'You solved the equation correctly! You get money from the bank.', 'success');
              const playerIndex = updatedPlayers.findIndex(p => p.userId === currentPlayer.userId);
              if (playerIndex !== -1) {
                updatedPlayers[playerIndex].money += BANK_AMOUNT_PER_CORRECT_ANSWER;
                bankMoney -= BANK_AMOUNT_PER_CORRECT_ANSWER;
                // Award a simple reward
                if (!playerRewards.includes('Equation Solver') && Math.random() < 0.5) { // 50% chance
                  rewardEarned = true;
                  const newUserRewards = [...playerRewards, 'Equation Solver'];
                  await updateDoc(doc(dbRef.current, 'artifacts', appId, 'users', user.uid), {
                    rewards: newUserRewards,
                  });
                  showAlert('Reward Earned!', 'You earned the "Equation Solver" reward!', 'info');
                }
              }
            } else {
              showAlert('Incorrect!', `Incorrect answer. The correct answer was ${actualAnswer}. You pay money to the bank.`, 'error', () => {
                // Offer hint after incorrect answer
                showConfirm(
                  'Need Help?',
                  `Would you like an explanation or a hint for "${equationToSolve}"?`,
                  async () => {
                    const hintPrompt = `Explain how to solve the math equation "${equationToSolve}" or provide a subtle hint to solve it. Do not give the answer directly.`;
                    const hint = await callGeminiApi(hintPrompt);
                    showAlert('Hint/Explanation ✨', hint, 'info', () => endTurn());
                  },
                  () => endTurn() // End turn if hint is declined
                );
              });
            }
            // Only end turn directly if no hint/explanation was offered or needed
            if (isNaN(parsedAnswer) || parsedAnswer === actualAnswer) { // Only end turn if correct or unparseable (implies immediate end)
                 await updateDoc(gameRef, { players: updatedPlayers, bankMoney: bankMoney });
                 await endTurn();
            } else { // If incorrect, the end turn is handled by the hint/explanation flow
                await updateDoc(gameRef, { players: updatedPlayers, bankMoney: bankMoney });
            }
          },
          className: 'bg-blue-600 hover:bg-blue-700',
        },
      ],
    });
  };


  const endTurn = async () => {
    const gameRef = doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', currentRoomId);
    if (!currentGame || !dbRef.current) return;

    const currentPlayers = currentGame.players;
    if (currentPlayers.length === 0) {
      console.warn("No players in game to end turn.");
      return;
    }

    const currentIndex = currentPlayers.findIndex(p => p.userId === currentGame.currentPlayerId);
    let nextPlayerIndex = (currentIndex + 1) % currentPlayers.length;
    let nextPlayerId = currentPlayers[nextPlayerIndex].userId;

    // Skip players who have been eliminated (if you add elimination logic)
    // For now, assume all players are active

    await updateDoc(gameRef, {
      currentPlayerId: nextPlayerId,
      turnCount: currentGame.turnCount + 1,
    });

    // Check for game end condition (e.g., after X turns, or if only one player remains)
    // Simplified: End after a certain number of total turns for demonstration
    if (currentGame.turnCount + 1 >= 25) { // Example: Reduced turns for testing LLM summary
      await endGame();
    }
  };

  const endGame = async () => {
    const gameRef = doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', currentRoomId);
    if (!currentGame || !dbRef.current) return;

    let winningPlayers = [];
    let maxProperty = -1;
    let maxMoney = -1;

    // Determine winner based on property count, then money
    currentGame.players.forEach(p => {
      if (p.propertyCount > maxProperty) {
        maxProperty = p.propertyCount;
        winningPlayers = [p];
        maxMoney = p.money; // Reset max money for new max property
      } else if (p.propertyCount === maxProperty) {
        if (p.money > maxMoney) {
          maxMoney = p.money;
          winningPlayers = [p];
        } else if (p.money === maxMoney) {
          winningPlayers.push(p);
        }
      }
    });

    const winnerMessage = winningPlayers.length > 1
      ? `It's a tie! Winners by money: ${winningPlayers.map(p => p.username).join(', ')}`
      : `Winner: ${winningPlayers[0].username} with ${winningPlayers[0].propertyCount} properties and $${winningPlayers[0].money}!`;

    // Generate game summary using Gemini API
    let gameSummary = 'Generating game summary...';
    try {
        const gameSummaryPrompt = `Generate a short (1-2 paragraphs) and fun game summary for a math board game called "Equation Challengers". The players were: ${currentGame.players.map(p => `${p.username} (Money: $${p.money}, Properties: ${p.propertyCount})`).join(', ')}. The winner is: ${winnerMessage}. Highlight any interesting moments based on the stats or general game theme.`;
        gameSummary = await callGeminiApi(gameSummaryPrompt);
    } catch (e) {
        console.error("Error generating game summary with Gemini:", e);
        gameSummary = "Failed to generate game summary.";
    }


    showAlert('Game Over!', (
        <div>
            <p className="mb-4 text-xl font-semibold">{winnerMessage}</p>
            <h4 className="text-xl font-bold text-yellow-300 mb-2">Game Recap ✨</h4>
            <p className="text-gray-200">{gameSummary}</p>
        </div>
    ), 'success', async () => {
      await updateDoc(gameRef, { status: 'finished', winner: winnerMessage, finalSummary: gameSummary }); // Mark game as finished
      // Optionally, clear currentRoomId for all players
      for (const player of currentGame.players) {
        await updateDoc(doc(dbRef.current, 'artifacts', appId, 'users', player.userId), {
          currentRoomId: null,
        }).catch(e => console.error(`Error clearing room for ${player.username}:`, e));
      }
      setCurrentRoomId(null);
      setCurrentGame(null);
      setCurrentPage('lobby');
    });

    // Award a reward for winning
    if (user && winningPlayers.some(wp => wp.userId === user.uid)) {
      if (!playerRewards.includes('Game Champion')) {
        const newUserRewards = [...playerRewards, 'Game Champion'];
        await updateDoc(doc(dbRef.current, 'artifacts', appId, 'users', user.uid), {
          rewards: newUserRewards,
        });
        showAlert('Reward Earned!', 'You earned the "Game Champion" reward!', 'info');
      }
    }
  };


  const handleInvitePlayer = async () => {
    const recipientId = prompt("Enter the User ID of the player you want to invite:");
    if (!recipientId || !user || !currentRoomId || !dbRef.current) {
      if (!recipientId) showAlert('Input Required', 'Please enter a User ID.', 'info');
      return;
    }

    try {
      const recipientDoc = await getDoc(doc(dbRef.current, 'artifacts', appId, 'users', recipientId));
      if (!recipientDoc.exists()) {
        showAlert('Error', 'User with this ID does not exist.', 'error');
        return;
      }
      if (recipientId === user.uid) {
        showAlert('Error', 'You cannot invite yourself.', 'error');
        return;
      }

      // Add invitation to game's invitations array
      const gameRef = doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', currentRoomId);
      const gameSnap = await getDoc(gameRef);
      const gameData = gameSnap.data();

      if (gameData.players.length >= 5) {
        showAlert('Error', 'The game is full. Cannot invite more players.', 'error');
        return;
      }

      const existingInvite = gameData.invitations.find(
        (invite) => invite.senderId === user.uid && invite.recipientId === recipientId && invite.status === 'pending'
      );
      if (existingInvite) {
        showAlert('Info', 'You have already sent an invitation to this player for this game.', 'info');
        return;
      }

      const newInvite = {
        senderId: user.uid,
        recipientId: recipientId,
        gameId: currentRoomId,
        status: 'pending',
        timestamp: new Date(),
        senderUsername: userProfile.username, // Add sender's username for better UX
      };

      await updateDoc(gameRef, {
        invitations: [...gameData.invitations, newInvite],
      });
      showAlert('Invitation Sent!', `Invitation sent to ${recipientDoc.data().username}.`, 'success');
    } catch (e) {
      console.error("Error inviting player:", e);
      showAlert('Error', `Failed to send invitation: ${e.message}`, 'error');
    }
  };

  // Listener for incoming invitations
  useEffect(() => {
    if (!user || !dbRef.current || !isAuthReady) return;

    const gameCollectionRef = collection(dbRef.current, 'artifacts', appId, 'public', 'data', 'games');
    const q = query(gameCollectionRef, where('status', '==', 'waiting')); // Only listen to waiting games for invites

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'modified' || change.type === 'added') {
          const gameData = change.doc.data();
          const gameId = change.doc.id;

          const myPendingInvite = gameData.invitations?.find(
            (invite) => invite.recipientId === user.uid && invite.status === 'pending'
          );

          if (myPendingInvite && currentRoomId !== gameId && currentPage !== 'game') {
            showConfirm(
              'Game Invitation!',
              `${myPendingInvite.senderUsername} invited you to join Game ID: ${gameId}. Do you want to join?`,
              async () => {
                await joinGame(gameId);
                // Mark invite as accepted
                const updatedInvites = gameData.invitations.map(inv =>
                  inv.inviteId === myPendingInvite.inviteId ? { ...inv, status: 'accepted' } : inv
                );
                await updateDoc(doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', gameId), {
                  invitations: updatedInvites,
                });
              },
              async () => {
                // Mark invite as declined
                const updatedInvites = gameData.invitations.map(inv =>
                  inv.inviteId === myPendingInvite.inviteId ? { ...inv, status: 'declined' } : inv
                );
                await updateDoc(doc(dbRef.current, 'artifacts', appId, 'public', 'data', 'games', gameId), {
                  invitations: updatedInvites,
                });
                showAlert('Invitation Declined', 'You declined the invitation.', 'info');
              }
            );
          }
        }
      });
    }, (error) => {
      console.error("Error listening for invitations:", error);
    });

    return () => unsubscribe();
  }, [user, currentRoomId, currentPage, isAuthReady, joinGame, showAlert, showConfirm]); // Depend on currentRoomId to prevent joining multiple games


  if (loadingAuth || !isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="animate-spin rounded-full h-32 w-32 border-t-4 border-b-4 border-blue-500"></div>
        <p className="ml-4 text-2xl">Loading Firebase...</p>
      </div>
    );
  }

  // --- Render based on currentPage state ---
  const renderContent = () => {
    switch (currentPage) {
      case 'login':
      case 'register':
        return (
          <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-900 to-indigo-900 text-white p-4 font-inter">
            <div className="bg-gray-800 p-8 rounded-xl shadow-2xl border-2 border-indigo-700 w-full max-w-md animate-fade-in">
              <h2 className="text-4xl font-extrabold text-center text-blue-300 mb-8 drop-shadow-lg">
                {currentPage === 'login' ? 'Login' : 'Register'} to Equation Challengers
              </h2>
              {currentPage === 'register' && (
                <input
                  type="text"
                  placeholder="Username"
                  className="w-full p-4 mb-4 rounded-lg bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              )}
              <input
                type="email"
                placeholder="Email"
                className="w-full p-4 mb-4 rounded-lg bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="password"
                placeholder="Password"
                className="w-full p-4 mb-6 rounded-lg bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                onClick={currentPage === 'login' ? handleLogin : handleRegister}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg text-xl"
              >
                {currentPage === 'login' ? 'Login' : 'Register'}
              </button>
              {error && <p className="text-red-400 text-center mt-4">{error}</p>}
              <button
                onClick={() => setCurrentPage(currentPage === 'login' ? 'register' : 'login')}
                className="w-full mt-4 text-blue-300 hover:text-blue-200 text-md transition-colors duration-200"
              >
                {currentPage === 'login' ? 'Need an account? Register' : 'Already have an account? Login'}
              </button>
            </div>
          </div>
        );

      case 'lobby':
        return (
          <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-green-900 to-teal-900 text-white p-4 font-inter">
            <div className="bg-gray-800 p-8 rounded-xl shadow-2xl border-2 border-teal-700 w-full max-w-2xl animate-fade-in">
              <h2 className="text-4xl font-extrabold text-center text-teal-300 mb-6 drop-shadow-lg">
                Equation Challengers Lobby
              </h2>
              {userProfile && (
                <div className="text-center mb-6 text-xl">
                  <p className="text-gray-200">Welcome, <span className="font-bold text-yellow-300">{userProfile.username}</span>!</p>
                  <p className="text-gray-300 text-sm">Your User ID: <span className="font-mono text-purple-300 text-xs break-words">{user.uid}</span></p>
                </div>
              )}

              <div className="flex justify-center space-x-4 mb-8">
                <button
                  onClick={createGame}
                  className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg text-lg"
                >
                  Create New Game
                </button>
                <button
                  onClick={() => {
                    const gameId = prompt("Enter Game ID to Join:");
                    if (gameId) joinGame(gameId);
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-full transition-all duration-300 transform hover:scale-105 shadow-lg text-lg"
                >
                  Join Game by ID
                </button>
              </div>

              <h3 className="text-2xl font-bold text-center text-teal-200 mb-4">Available Games</h3>
              {availableRooms.length === 0 ? (
                <p className="text-gray-400 text-center">No games waiting for players. Create one!</p>
              ) : (
                <ul className="space-y-3">
                  {availableRooms.map((room) => (
                    <li key={room.id} className="bg-gray-700 p-4 rounded-lg flex items-center justify-between shadow-md">
                      <div>
                        <p className="text-lg font-semibold text-white">Game ID: <span className="font-mono text-sm">{room.id}</span></p>
                        <p className="text-gray-300 text-sm">Players: {room.players.length} / 5</p>
                        <p className="text-gray-400 text-xs">Host: {room.players[0]?.username || 'N/A'}</p>
                      </div>
                      <button
                        onClick={() => joinGame(room.id)}
                        className="bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded-full text-md transition-all duration-300 transform hover:scale-105"
                      >
                        Join
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-8 pt-6 border-t border-gray-700 flex justify-between">
                <button
                  onClick={handleLogout}
                  className="bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-full text-md transition-all duration-300 transform hover:scale-105 shadow-md"
                >
                  Logout
                </button>
                <button
                  onClick={handleDeleteAccount}
                  className="bg-red-800 hover:bg-red-900 text-white py-2 px-4 rounded-full text-md transition-all duration-300 transform hover:scale-105 shadow-md"
                >
                  Delete Account
                </button>
              </div>

              {/* Rewards Section */}
              <div className="mt-8 pt-6 border-t border-gray-700">
                <h3 className="text-2xl font-bold text-center text-yellow-300 mb-4">Your Rewards</h3>
                {playerRewards.length === 0 ? (
                  <p className="text-gray-400 text-center">No rewards yet. Keep playing to earn some!</p>
                ) : (
                  <div className="flex flex-wrap justify-center gap-3">
                    {playerRewards.map((reward, index) => (
                      <span key={index} className="bg-yellow-600 text-yellow-100 px-4 py-2 rounded-full text-sm font-semibold shadow-md">
                        ✨ {reward}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'game':
        if (!currentGame) {
          return <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">Loading Game...</div>;
        }

        const myPlayer = currentGame.players.find(p => p.userId === user?.uid);
        const currentPlayerInGame = getCurrentPlayer();

        return (
          <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-4 font-inter flex flex-col items-center justify-center">
            <h1 className="text-5xl font-extrabold text-center text-purple-400 mb-6 drop-shadow-lg">
              Equation Challengers!
            </h1>
            <p className="text-xl text-gray-300 mb-8">Game ID: <span className="font-mono text-purple-300 text-sm">{currentRoomId}</span></p>

            {/* Player Info Section */}
            <div className="w-full max-w-6xl bg-gray-800 rounded-xl p-6 shadow-2xl border-2 border-gray-700 mb-8">
              <h3 className="text-2xl font-bold text-purple-300 mb-4 text-center">Players ({currentGame.players.length}/5)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {currentGame.players.map((player, index) => (
                  <div
                    key={player.userId}
                    className={`p-4 rounded-lg shadow-md flex items-center justify-between transition-all duration-300
                      ${player.userId === currentPlayerInGame?.userId ? 'bg-indigo-700 border-2 border-yellow-400 transform scale-105' : 'bg-gray-700 border border-gray-600'}
                    `}
                  >
                    <div>
                      <p className="text-xl font-semibold flex items-center">
                        <span className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: player.color }}></span>
                        {player.username} {player.userId === user.uid && '(You)'}
                      </p>
                      <p className="text-md text-gray-300">Money: <span className="font-bold text-green-400">${player.money}</span></p>
                      <p className="text-md text-gray-300">Properties: <span className="font-bold text-yellow-400">{player.propertyCount}</span></p>
                      <p className="text-md text-gray-300">Position: <span className="font-bold text-blue-400">{player.position}</span></p>
                    </div>
                    {player.userId === user.uid && userProfile && (
                       <button
                         onClick={() => {
                           // Show own user ID for easy sharing
                           showAlert('Your User ID', `Your User ID is: ${user.uid}`, 'info');
                         }}
                         className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-full text-sm transition-all duration-200"
                       >
                         Show My ID
                       </button>
                     )}
                  </div>
                ))}
              </div>
            </div>

            {/* Game Board and Dice */}
            <div className="relative w-full max-w-4xl aspect-video bg-cover bg-center rounded-xl shadow-2xl border-4 border-yellow-500 mb-8 overflow-hidden"
                 style={{ backgroundImage: `url(${boardImage})` }}>
              {/* This div represents the board background */}
              <div className="absolute inset-0">
                {/* Render player pieces */}
                {currentGame.players.map(player => (
                  <div
                    key={`piece-${player.userId}`}
                    className="absolute w-6 h-6 rounded-full border-2 border-white transform -translate-x-1/2 -translate-y-1/2 transition-all duration-700 ease-in-out"
                    style={{
                      backgroundColor: player.color,
                      left: `${(player.position / boardSize) * 100}%`, // Simplified, adjust based on actual board layout
                      top: `calc(50% + ${player.userId.charCodeAt(0) % 2 * 10}px)`, // Slight offset to prevent overlap
                    }}
                  ></div>
                ))}
              </div>
            </div>

            {/* Dice and Actions */}
            <div className="bg-gray-800 p-6 rounded-xl shadow-2xl border-2 border-gray-700 flex flex-col items-center space-y-6 w-full max-w-lg mb-8">
              <h3 className="text-2xl font-bold text-yellow-300 text-center">
                {isMyTurn ? 'Your Turn!' : `It's ${currentPlayerInGame?.username}'s Turn`}
              </h3>
              <div className="relative w-24 h-24 flex items-center justify-center">
                <div
                  className={`dice-face w-20 h-20 bg-gray-600 rounded-lg flex items-center justify-center text-5xl font-bold text-white shadow-xl ${diceRolling ? 'animate-spin-dice' : ''}`}
                >
                  {diceResult}
                </div>
              </div>

              {isMyTurn && (
                <button
                  onClick={rollDice}
                  disabled={diceRolling}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-8 rounded-full text-xl transition-all duration-300 transform hover:scale-105 shadow-lg
                    disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {diceRolling ? 'Rolling...' : 'Roll Dice'}
                </button>
              )}
               <button
                 onClick={handleInvitePlayer}
                 className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-full text-md transition-all duration-300 transform hover:scale-105 shadow-md"
               >
                 Invite Player by ID
               </button>
            </div>

            {/* Money Notes Display (Static for now, but can be dynamic) */}
            <div className="w-full max-w-6xl bg-gray-800 rounded-xl p-6 shadow-2xl border-2 border-gray-700 mt-6 mb-8">
              <h3 className="text-2xl font-bold text-purple-300 mb-4 text-center">Money Notes</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 justify-items-center">
                {Object.entries(moneyNotes).map(([value, src]) => (
                  <div key={value} className="flex flex-col items-center">
                    <img
                      src={src}
                      alt={`$${value} note`}
                      className="w-24 h-auto rounded-lg shadow-md border border-gray-600"
                      onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/100x50/3498db/ffffff?text=${value}`; }}
                    />
                    <span className="mt-2 text-gray-300 text-sm">${value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Game Controls */}
            <div className="w-full max-w-md flex justify-around mt-8">
              <button
                onClick={() => leaveGame(currentRoomId)}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-full text-lg transition-all duration-300 transform hover:scale-105 shadow-lg"
              >
                Leave Game
              </button>
              {/* Optional: Add a button to manually end game if you want for testing/admin */}
              {/* <button
                onClick={endGame}
                className="bg-red-800 hover:bg-red-900 text-white font-bold py-3 px-6 rounded-full text-lg transition-all duration-300 transform hover:scale-105 shadow-lg"
              >
                End Game
              </button> */}
            </div>
          </div>
        );

      default:
        return <div className="text-center text-white">Unknown Page</div>;
    }
  };

  return (
    <div className="font-sans">
      {renderContent()}
      <Modal
        isOpen={modal.isOpen}
        title={modal.title}
        buttons={modal.buttons}
        onClose={() => setModal({ ...modal, isOpen: false })}
      >
        {modal.content}
      </Modal>
    </div>
  );
};

export default App;

