import * as signalR from '@microsoft/signalr';

let sudokuConnection: signalR.HubConnection | null = null;
let gameConnection: signalR.HubConnection | null = null;

export function getConnection(): signalR.HubConnection {
  if (!sudokuConnection) {
    const baseUrl = window.location.origin;
    sudokuConnection = new signalR.HubConnectionBuilder()
      .withUrl(`${baseUrl}/api/hubs/sudoku`)
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Information)
      .build();
  }
  return sudokuConnection;
}

export async function startConnection(): Promise<signalR.HubConnection> {
  const conn = getConnection();
  if (conn.state === signalR.HubConnectionState.Disconnected) {
    await conn.start();
  }
  return conn;
}

export async function stopConnection(): Promise<void> {
  if (sudokuConnection && sudokuConnection.state !== signalR.HubConnectionState.Disconnected) {
    await sudokuConnection.stop();
  }
}

// Game hub (for TwentyFour and future games)
export function getGameConnection(): signalR.HubConnection {
  if (!gameConnection) {
    const baseUrl = window.location.origin;
    gameConnection = new signalR.HubConnectionBuilder()
      .withUrl(`${baseUrl}/api/hubs/game`)
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Information)
      .build();
  }
  return gameConnection;
}

export async function startGameConnection(): Promise<signalR.HubConnection> {
  const conn = getGameConnection();
  if (conn.state === signalR.HubConnectionState.Disconnected) {
    await conn.start();
  }
  return conn;
}

export async function stopGameConnection(): Promise<void> {
  if (gameConnection && gameConnection.state !== signalR.HubConnectionState.Disconnected) {
    await gameConnection.stop();
  }
}
