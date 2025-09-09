/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// by free.light - 08/2025 - iamfreelight@gmail.com - virtualworldsystems.com
/////////////////////////////////////////////////////////////////////////////////////////
    
import * as ui from 'horizon/ui';
import * as hz from 'horizon/core';

import LocalCamera, { CameraTransitionOptions, Easing } from 'horizon/camera';

import {
  Component,
  Player,
  PlayerInput,
  PlayerControls,
  PlayerInputAction,
  PlayerDeviceType,
  ButtonIcon,
  ButtonPlacement,
  CodeBlockEvents,
  PropTypes,
  Entity,
  PhysicalEntity,
  AvatarPoseGizmo,
  World,
  PhysicsForceMode,
  RaycastGizmo,
  Vec3,
  Quaternion,
  AudioGizmo,
  EventSubscription,
  ParticleGizmo, 
  TrailGizmo,
  AvatarGripPose,
  NetworkEvent,
  Asset, 
  EntityInteractionMode,
  TextureAsset,
} from 'horizon/core';

import { ImageSource } from 'horizon/ui';

const CustomVehicleMessage = new NetworkEvent<{ vehicleId: string; message: string }>('CustomVehicleMessage');

type VehicleProgress = {
  vehicle: hz.Entity;
  lastTriggerIndex: number;
  lap: number;
  finished: boolean;
  position?: number;
  passedHalfway?: boolean;
  disqualified?: boolean;
};

const ResetEvent = new NetworkEvent<{
  entityId: string;
  command: 'reset';
  triggerPosition: hz.Vec3;
  triggerRotation: hz.Quaternion;
}>('ResetEvent');

const RaceControlEvent = new hz.NetworkEvent<{ command: 'start' | 'stop' | 'finished' }>('RaceControlEvent');
const VehiclePositionEvent = new hz.NetworkEvent<{ position: number }>('VehiclePositionEvent');
const TeleportPlayerEvent = new hz.NetworkEvent<{ playerId: string }>('TeleportPlayerEvent');

const VehicleProgressEvent = new NetworkEvent<{
  lap: number;
  lapCount: number;
  raceActive: boolean;
  finished: boolean;
}>('VehicleProgressEvent');

const playerLBEvent = new hz.NetworkEvent<{ playerId: number; seconds: number }>('playerLB');

const VehicleOccupantEvent = new NetworkEvent<{ 
  vehicleId: bigint; 
  playerId: number; // 0 = empty 
}>('VehicleOccupantEvent');

const syncTimeEvent = new hz.NetworkEvent<{ timestamp: number }>('syncTime');

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// RaceController
/////////////////////////////////////////////////////////////////////////////////////////

class RK_RaceController extends hz.Component<typeof RK_RaceController> {
  static propsDefinition = {
    debugMode: { type: hz.PropTypes.Boolean, default: true },

    startButtonTrigger: { type: hz.PropTypes.Entity },
    stopButtonTrigger: { type: hz.PropTypes.Entity },

    vehicle1: { type: hz.PropTypes.Entity },
    vehicle2: { type: hz.PropTypes.Entity },
    vehicle3: { type: hz.PropTypes.Entity },
    vehicle4: { type: hz.PropTypes.Entity },
    vehicle5: { type: hz.PropTypes.Entity },
    vehicle6: { type: hz.PropTypes.Entity },
    vehicle7: { type: hz.PropTypes.Entity },
    vehicle8: { type: hz.PropTypes.Entity },

    startFinishTrigger: { type: hz.PropTypes.Entity },

    checkpoint1: { type: hz.PropTypes.Entity },
    checkpoint2: { type: hz.PropTypes.Entity },
    checkpoint3: { type: hz.PropTypes.Entity },
    checkpoint4: { type: hz.PropTypes.Entity },
    checkpoint5: { type: hz.PropTypes.Entity },
    checkpoint6: { type: hz.PropTypes.Entity },
    checkpoint7: { type: hz.PropTypes.Entity },
    checkpoint8: { type: hz.PropTypes.Entity },
    checkpoint9: { type: hz.PropTypes.Entity },
    checkpoint10: { type: hz.PropTypes.Entity },
    checkpoint11: { type: hz.PropTypes.Entity },
    checkpoint12: { type: hz.PropTypes.Entity },
    checkpoint13: { type: hz.PropTypes.Entity },
    checkpoint14: { type: hz.PropTypes.Entity },
    checkpoint15: { type: hz.PropTypes.Entity },
    checkpoint16: { type: hz.PropTypes.Entity },
    checkpoint17: { type: hz.PropTypes.Entity },
    checkpoint18: { type: hz.PropTypes.Entity },
    checkpoint19: { type: hz.PropTypes.Entity },
    checkpoint20: { type: hz.PropTypes.Entity },
    
    halfwayTrigger: { type: hz.PropTypes.Entity },

    lapCount: { type: hz.PropTypes.Number, default: 3 },
    
    finishRaceParticleFx1: { type: hz.PropTypes.Entity },
    finishRaceAudio1: { type: hz.PropTypes.Entity },
    
    RaceFinishedResetTime: { type: hz.PropTypes.Number, default: 15 },
    
    liveLeaderboard: { type: hz.PropTypes.Entity },
    liveLeaderboard2: { type: hz.PropTypes.Entity },
    
    maxRaceDuration: { type: hz.PropTypes.Number, default: 600 }, //600 = 10min for max race length before disqual
  };

  private raceActive = false;
  private progress: Map<string, VehicleProgress> = new Map();
  private triggers: hz.Entity[] = [];
  private nextFinishPosition = 1;
  
  private triggerCount = 0;
  
  private finishRaceAudio1?: AudioGizmo;
  private finishRaceParticleFx1?: ParticleGizmo;
  
  private vehiclePlayerMap: Map<bigint, number> = new Map();

  private vehicles: hz.Entity[] = [];
  
  private raceElapsed = 0;

  override preStart() {
    this.connectNetworkEvent(this.entity, RaceControlEvent, (data) => {
      if (this.props.debugMode) console.log('[RK_RaceController] Received race event', data);
      if (data.command === 'start') this.startRace();
      if (data.command === 'stop') this.stopRace();
    });
    
    // Handle reset events from triggers
    this.connectNetworkEvent(this.entity, ResetEvent, (data) => this.onResetTrigger(data));
    
    if (this.props.finishRaceAudio1) {
      this.finishRaceAudio1 = this.props.finishRaceAudio1.as(AudioGizmo);
    }
    
    this.finishRaceParticleFx1 = this.props.finishRaceParticleFx1?.as(ParticleGizmo);
  }
  
  private setupVehicleEvents(vehicle: hz.Entity) {
    this.connectNetworkEvent(vehicle, VehicleOccupantEvent, (data) => {
    const prog = this.progress.get(vehicle.id.toString());

    if (data.playerId === 0) {
      if (this.raceActive) {
        this.vehiclePlayerMap.delete(data.vehicleId);
        if (prog) {
          prog.disqualified = true;
          if (this.props.debugMode) {
            console.log(`[DQ] Vehicle ${vehicle.id} disqualified (no occupant).`);
          }
        }
      }
    } else {
      this.vehiclePlayerMap.set(data.vehicleId, data.playerId);

      if (prog) {
        prog.disqualified = false; // back in the race
      }

      // NEW: Send current VehicleProgressEvent to the new occupant
      const current = this.progress.get(vehicle.id.toString());
      if (current) {
        this.sendNetworkEvent(vehicle, VehicleProgressEvent, {
          lap: Math.min(current.lap, this.props.lapCount ?? 3),
          lapCount: this.props.lapCount ?? 3,
          raceActive: this.raceActive,
          finished: current.finished,
        });
      }
    }
    });
  }

  private onResetTrigger(data: { entityId: string; command: 'reset'; triggerPosition: hz.Vec3; triggerRotation: hz.Quaternion }) {
    const prog = this.progress.get(data.entityId);
    if (!prog) return;

    const lastTriggerIndex = prog.lastTriggerIndex;
    if (lastTriggerIndex < 0 || lastTriggerIndex >= this.triggers.length) return;

    const checkpoint = this.triggers[lastTriggerIndex];
    if (!checkpoint) return;

    const checkpointPos = checkpoint.position.get();
    const checkpointRot = checkpoint.rotation.get();

    // send event to vehicle with checkpoint pos/rot
    this.sendNetworkEvent(
        prog.vehicle,
        ResetEvent,
        {
            entityId: prog.vehicle.id.toString(),
            command: 'reset',
            triggerPosition: checkpointPos,
            triggerRotation: checkpointRot,
        }
    );

    if (this.props.debugMode) {
        console.log(`[RK_RaceController] Vehicle ${prog.vehicle.id} reset to last checkpoint ${lastTriggerIndex}`);
    }
  }

  override start() {
    // Collect triggers: start/finish + checkpoints dynamically
    this.triggers = [];

    if (this.props.startFinishTrigger) {
        this.triggers.push(this.props.startFinishTrigger);
    }

    for (let i = 1; i <= 20; i++) {
        const checkpoint = (this.props as any)[`checkpoint${i}`] as hz.Entity | undefined;
        if (checkpoint) this.triggers.push(checkpoint);
    }

    this.triggerCount = this.triggers.length;

    if (this.props.debugMode) console.log(`[RK_RaceController] Total triggers: ${this.triggers.length}`);

    // Connect triggers to OnEntityEnterTrigger events
    this.triggers.forEach((trig, i) => {
        this.connectCodeBlockEvent(
            trig,
            hz.CodeBlockEvents.OnEntityEnterTrigger,
            (enteredBy: hz.Entity) => this.onTriggerHit(enteredBy, i)
        );
        if (this.props.debugMode) console.log(`Connected trigger ${i} to entity ${trig.id}`);
    });

    // Halfway trigger
    if (this.props.halfwayTrigger) {
        this.connectCodeBlockEvent(
            this.props.halfwayTrigger,
            hz.CodeBlockEvents.OnEntityEnterTrigger,
            (enteredBy: hz.Entity) => this.onHalfwayHit(enteredBy)
        );
        if (this.props.debugMode) console.log(`Connected halfway trigger to entity ${this.props.halfwayTrigger.id}`);
    }

    // Start button
    if (this.props.startButtonTrigger) {
        this.connectCodeBlockEvent(
            this.props.startButtonTrigger,
            hz.CodeBlockEvents.OnEntityEnterTrigger,
            (e: hz.Entity) => {
                if (this.isVehicleEntity(e)) {
                    if (this.props.debugMode) console.log('[StartButton] Vehicle triggered');
                    if (!this.raceActive) this.sendNetworkEvent(this.entity, RaceControlEvent, { command: 'start' });
                }
            }
        );
    }

    // Stop button
    if (this.props.stopButtonTrigger) {
        this.connectCodeBlockEvent(
            this.props.stopButtonTrigger,
            hz.CodeBlockEvents.OnEntityEnterTrigger,
            (e: hz.Entity) => {
                if (this.isVehicleEntity(e)) {
                    if (this.props.debugMode) console.log('[StopButton] Vehicle triggered');
                    if (this.raceActive) this.sendNetworkEvent(this.entity, RaceControlEvent, { command: 'stop' });
                }
            }
        );
    }

    // Stop any looping audio at start
    this.props.finishRaceAudio1?.as(AudioGizmo)?.stop();

    // Subscribe to world update for position updates
    this.connectLocalBroadcastEvent(hz.World.onUpdate, (data) => this.onUpdate(data.deltaTime));
    
    this.vehicles = this.getVehicles();
    this.vehicles.forEach(v => this.setupVehicleEvents(v));
    
    // Send the server timestamp to all clients every second 
    this.async.setInterval(() => {
      const currentTime = Date.now();
      this.sendNetworkBroadcastEvent(syncTimeEvent, { timestamp: currentTime });
    }, 1000);        
  }
  
  private updateTimer = 0;
  private updateInterval = 0.25; // seconds

  private onUpdate(dt: number) {
    if (!this.raceActive) return;

    this.updateTimer += dt;
    this.raceElapsed += dt;
    
    if (this.updateTimer >= this.updateInterval) {
        this.updatePositions();
        this.updateTimer = 0;
    }

    if (this.raceElapsed >= this.props.maxRaceDuration) {
      if (this.props.debugMode) {
        console.log(`[RK_RaceController] Race exceeded ${this.props.maxRaceDuration} seconds. Forcing stop.`);
      }

      this.getVehicles().forEach(v => {
        const p = this.progress.get(v.id.toString());
        if (!p) return;
        this.sendNetworkEvent(v, VehicleProgressEvent, {
          lap: Math.min(p.lap, this.props.lapCount ?? 3),
          lapCount: this.props.lapCount ?? 3,
          raceActive: false,
          finished: true,
        });
      });

      this.raceActive = false;
      this.RaceCompleted();
    }
  }  

  private getVehicles(): hz.Entity[] {
    return [
      this.props.vehicle1,
      this.props.vehicle2,
      this.props.vehicle3,
      this.props.vehicle4,
      this.props.vehicle5,
      this.props.vehicle6,
      this.props.vehicle7,
      this.props.vehicle8,
    ].filter(Boolean) as hz.Entity[];
  }

  private isVehicleEntity(e?: hz.Entity | null) {
    if (!e) return false;
    return this.getVehicles().some(v => v.id === e.id);
  }

  private startRace() {
    // Just incase its set to loop, and is playing when we start or restart the race
    const audioGizmo1 = this.props.finishRaceAudio1?.as(AudioGizmo);
    audioGizmo1?.stop();
  
    this.raceActive = true;
    this.progress.clear();
    this.nextFinishPosition = 1;
    this.raceElapsed = 0;

    this.vehicles = this.getVehicles();

    // Initialize progress for each vehicle
    this.vehicles.forEach((veh) => {
        this.progress.set(veh.id.toString(), {
            vehicle: veh,
            lastTriggerIndex: 0,
            lap: 1,
            finished: false,
            passedHalfway: false,
        });
    });
    
    this.clearLiveLeaderboard();

    if (this.props.debugMode) console.log('[RK_RaceController] Race started with', this.vehicles.length, 'vehicles.');

    this.updatePositions();

    // Send progress update and 'start' command to all vehicles
    this.vehicles.forEach((veh) => {
        const p = this.progress.get(veh.id.toString());
        if (!p) return;

        // Send 'start' command
        this.sendNetworkEvent(veh, RaceControlEvent, { command: 'start' });

        // Send initial VehicleProgressEvent with new 'finished' field
        this.sendNetworkEvent(veh, VehicleProgressEvent, {
            lap: Math.min(p.lap, this.props.lapCount ?? 3),
            lapCount: this.props.lapCount ?? 3,
            raceActive: this.raceActive,
            finished: p.finished,
        });
        
        this.sendNetworkEvent(veh, RaceControlEvent, { command: 'start' });
    });

    // Broadcast initial race progress to all vehicles (full loop)
    this.vehicles.forEach((veh) => {
        const p = this.progress.get(veh.id.toString());
        if (!p) return;

        this.vehicles.forEach((v) => {
            const prog = this.progress.get(v.id.toString());
            if (!prog) return;

            this.sendNetworkEvent(v, VehicleProgressEvent, {
                lap: Math.min(prog.lap, this.props.lapCount ?? 3),
                lapCount: this.props.lapCount ?? 3,
                raceActive: this.raceActive,
                finished: prog.finished,
                });
        });
    });

    const realVehicles = this.getVehicles();
    for (const vehicle of realVehicles) {
      this.sendNetworkEvent(vehicle, VehicleOccupantEvent, {
        vehicleId: vehicle.id,
        playerId: 0,
      });
    }
    
    if (this.props.debugMode) console.log('[RK_RaceController] All vehicles have been notified of race start.');
  }

  private stopRace() {
    this.raceActive = false;
    if (this.props.debugMode) console.log('[RK_RaceController] Race stopped.');

    this.updatePositions();

    // Send update to all vehicles with the new 'finished' field
    this.getVehicles().forEach(v => {
        const p = this.progress.get(v.id.toString());
        if (!p) return;

        this.sendNetworkEvent(v, VehicleProgressEvent, {
            lap: Math.min(p.lap, this.props.lapCount ?? 3), // dont show lap > lapCount
            lapCount: this.props.lapCount ?? 3,
            raceActive: this.raceActive,
            finished: p.finished,
        });
        
        this.sendNetworkEvent(v, RaceControlEvent, { command: 'stop' });
    });
    
    this.finishRaceParticleFx1?.stop();
    this.finishRaceAudio1?.stop();
  }

  private maxSkip = 3;
  private onHalfwayHit(entity: hz.Entity) {
    const key = entity.id.toString();
    const prog = this.progress.get(key);
    if (!prog || prog.finished) return;

    const half = Math.floor(this.triggerCount / 2);
    if (prog.lastTriggerIndex >= half - this.maxSkip) {
      prog.passedHalfway = true;
      if (this.props.debugMode) console.log(`[Halfway] Vehicle ${entity.id} passed halfway`);
    }
  }

  private onTriggerHit(entity: hz.Entity, triggerIndex: number) {
    if (this.props.debugMode) console.log(`[Trigger] Vehicle ${entity.id} hit trigger index ${triggerIndex}`);

    if (!this.raceActive) return;

    const key = entity.id.toString();
    const prog = this.progress.get(key);
    if (!prog) return;

    if (triggerIndex === 0) { // start/finish trigger
      if (prog.passedHalfway) {
        prog.lap++;
        prog.lastTriggerIndex = 0; // Reset to start/finish trigger
        prog.passedHalfway = false;

        if (prog.lap > (this.props.lapCount ?? 3)) { // finished race
          prog.finished = true;
          prog.position = this.nextFinishPosition++;

          if (this.props.debugMode) console.log(`[Race] Vehicle ${entity.id} finished! Position: ${prog.position}`);

          // First finisher: disqualify vehicles still on lap 1 or not progressed
          if (prog.position === 1) {
            this.progress.forEach(p => {
              if (!p.finished && !p.disqualified && p.lap === 1 && p.lastTriggerIndex <= 0) {
                p.disqualified = true;
                if (this.props.debugMode) console.log(`[DQ] Vehicle ${p.vehicle.id} did not move – disqualified`);
                this.sendNetworkEvent(p.vehicle, RaceControlEvent, { command: "stop" });
              }
            });
          }

          // Stop this vehicle only
          this.sendNetworkEvent(entity, RaceControlEvent, { command: "stop" });
        }
      } else {
        if (this.props.debugMode) console.log(`[Race] Vehicle ${entity.id} hit start/finish without passing halfway. Lap not counted.`);
      }

      // Broadcast updated progress to all real vehicles
      this.getVehicles().forEach(v => {
        const p = this.progress.get(v.id.toString());
        if (!p) return;
        this.sendNetworkEvent(v, VehicleProgressEvent, {
          lap: Math.min(p.lap, this.props.lapCount ?? 3),
          lapCount: this.props.lapCount ?? 3,
          raceActive: this.raceActive,
          finished: p.finished,
        });
      });

    } else {
      // Normal checkpoint triggers
      if (triggerIndex > prog.lastTriggerIndex && triggerIndex - prog.lastTriggerIndex <= this.maxSkip) {
        prog.lastTriggerIndex = triggerIndex;

        // Mark halfway if needed
        if (
          triggerIndex >= Math.floor(this.triggerCount / 2) &&
          !prog.passedHalfway
        ) {
          prog.passedHalfway = true;
          if (this.props.debugMode) console.log(`[Race] Vehicle ${entity.id} passed halfway point.`);
        }
      }
    }

    // Always update positions after a trigger hit
    this.updatePositions();
  }

  private getProgressScore(r: VehicleProgress): number {
    if (r.finished) return 1_000_000 + r.position!; // finished vehicles always ahead

    // Laps completed
    let lapProgress = r.lap - 1;

    // Base = lap progress * total triggers
    let base = lapProgress * this.triggerCount;

    let currentIndex = r.lastTriggerIndex;
    let t = 0;
    let advances = 0;
    const MAX_ADVANCES = 5; // Prevent infinite loops

    while (advances < MAX_ADVANCES) {
      const nextIndex = (currentIndex + 1) % this.triggerCount;
      if (nextIndex === 0) break; // Don't virtually complete lap

      const lastTrigger = this.triggers[currentIndex];
      const nextTrigger = this.triggers[nextIndex];
      if (!lastTrigger || !nextTrigger) break;

      const a = lastTrigger.position.get();
      const b = nextTrigger.position.get();

      const ab = b.sub(a);
      const ap = r.vehicle.position.get().sub(a);

      const denom = ab.dot(ab);
      if (denom <= 0) break;

      const proj = ap.dot(ab) / denom;

      if (proj <= 1) {
        t = Math.max(0, proj);
        break;
      } else {
        // Past this segment, virtually advance
        currentIndex = nextIndex;
        advances++;
      }
    }

    return base + currentIndex + t;
  }

  private PlayerLeaderboardUpdateEvent = new NetworkEvent<{
    leaderboard: { playerId: string; playerName: string; textureIndex: number; position: number }[];
  }>('PlayerLeaderboardUpdateEvent');

  private updatePositions() {
    this.vehicles = this.getVehicles();
    const realVehicleIds = this.vehicles.map(v => v.id);

    const racers = Array.from(this.progress.values())
        .filter(r => realVehicleIds.includes(r.vehicle.id));

    // Sort by finished first, then by progress score
    racers.sort((a, b) => {
        if (a.finished && b.finished) return (a.position ?? 0) - (b.position ?? 0);
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        return this.getProgressScore(b) - this.getProgressScore(a);
    });

    // Assign positions + send events
    racers.forEach((r, i) => {
        r.position = i + 1;
        this.sendNetworkEvent(r.vehicle, VehiclePositionEvent, { position: r.position });
        
    });

    /*
    // this is helpful but for debugging the progress score logic, but very spammy
    if (this.props.debugMode) {
        console.log('[Positions]');
        racers.forEach(r =>
            console.log(`Pos ${r.position}: Vehicle ${r.vehicle.id} lap=${r.lap} trig=${r.lastTriggerIndex} prog=${this.getProgressScore(r).toFixed(2)} finished=${r.finished} dq=${r.disqualified}`)
        );
    }
    */
	

    const leaderboardData = racers.map(r => {
      const playerId = this.vehiclePlayerMap.get(r.vehicle.id);
      let playerName = 'Unoccupied';

      if (playerId) {
        const player = this.world.getPlayers().find(p => p.id.toString() === playerId.toString());
        if (player) {
          playerName = String(player.name.get() ?? '').trim();
        } else {
          playerName = `Player ${playerId}`;
        }
      }

      return {
        playerId: playerId?.toString() ?? r.vehicle.id.toString(),
        playerName,
        textureIndex: 0,
        position: r.position!
      };
    });

    if (this.raceActive == true)
    {
      if (this.props.liveLeaderboard)
      {
        this.sendNetworkEvent(this.props.liveLeaderboard, 
          this.PlayerLeaderboardUpdateEvent, 
          { leaderboard: leaderboardData }
        );
      }
      
      if (this.props.liveLeaderboard2)
      {
        this.sendNetworkEvent(this.props.liveLeaderboard2, 
          this.PlayerLeaderboardUpdateEvent, 
          { leaderboard: leaderboardData }
        );
      }
    }

    const activeRacers = racers.filter(r => !r.disqualified);
    const allFinished = activeRacers.length > 0 && activeRacers.every(r => r.finished);

    if (this.raceActive && allFinished) {
        this.raceActive = false;
        this.RaceCompleted();
    }
  }
  
  public clearLiveLeaderboard() {
    // Send an empty leaderboard
    const leaderboardUpdateEvent = new NetworkEvent<{ leaderboard: { playerId: string; playerName: string; textureIndex?: number; position: number }[]; }>('PlayerLeaderboardUpdateEvent');
    if (this.props.liveLeaderboard) this.sendNetworkEvent(this.props.liveLeaderboard, leaderboardUpdateEvent, { leaderboard: [] });
    if (this.props.liveLeaderboard2) this.sendNetworkEvent(this.props.liveLeaderboard2, leaderboardUpdateEvent, { leaderboard: [] });
  }

  getPlacements() {
    const realVehicles = this.getVehicles().map(v => v.id.toString());

    const racers = Array.from(this.progress.values())
        .filter(r => realVehicles.includes(r.vehicle.id.toString())) // only real vehicles
        .sort((a, b) => {
            if (a.finished && b.finished) return (a.position ?? 0) - (b.position ?? 0);
            if (a.finished !== b.finished) return a.finished ? -1 : 1;
            if (a.lap !== b.lap) return b.lap - a.lap;
            return b.lastTriggerIndex - a.lastTriggerIndex;
        });

    return racers.map((r, i) => ({
        position: i + 1,
        vehicleId: r.vehicle.id.toString(),
        lap: r.lap,
        finished: r.finished,
        disqualified: r.disqualified ?? false
    }));
  }

  private RaceCompleted() {    
    const audioGizmo1 = this.props.finishRaceAudio1?.as(AudioGizmo);
    audioGizmo1?.play();

    const particleGizmo1 = this.props.finishRaceParticleFx1?.as(ParticleGizmo);
    particleGizmo1?.play();
    
    if (this.props.debugMode) console.log("[RK_RaceController] All vehicles have finished! Race complete.");
    
    this.async.setTimeout(() => {
      this.sendNetworkEvent(this.entity, RaceControlEvent, { command: 'finished' });
      this.stopRace();
    }, this.props.RaceFinishedResetTime * 1000);
  }  
}

hz.Component.register(RK_RaceController);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// UI 'live map' script
/////////////////////////////////////////////////////////////////////////////////////////

// --- Types ---
export interface MapDot {
  node: ui.UINode;
  vehicle: hz.Entity;
  color: string;
  leftBinding: ui.Binding<number>;
  topBinding: ui.Binding<number>;
}

// --- Component ---
export class RK_MapUIManager extends ui.UIComponent<typeof RK_MapUIManager> {
  static propsDefinition = {
    // Map positioning
    mapAnchor: { type: hz.PropTypes.String, default: 'bottom-right' },
    mapOffsetX: { type: hz.PropTypes.Number, default: 20 },
    mapOffsetY: { type: hz.PropTypes.Number, default: 20 },
    mapWidth: { type: hz.PropTypes.Number, default: 400 },
    mapHeight: { type: hz.PropTypes.Number, default: 400 },

    // Zoom and rotation
    mapZoom: { type: hz.PropTypes.Number, default: 1 },
    mapRotation: { type: hz.PropTypes.Number, default: 0 },

    Vehicle1: { type: hz.PropTypes.Entity },  Vehicle1Color: { type: hz.PropTypes.String, default: '#FF0000' },
    Vehicle2: { type: hz.PropTypes.Entity },  Vehicle2Color: { type: hz.PropTypes.String, default: '#00FF00' },
    Vehicle3: { type: hz.PropTypes.Entity },  Vehicle3Color: { type: hz.PropTypes.String, default: '#0000FF' },
    Vehicle4: { type: hz.PropTypes.Entity },  Vehicle4Color: { type: hz.PropTypes.String, default: '#FFFF00' },
    Vehicle5: { type: hz.PropTypes.Entity },  Vehicle5Color: { type: hz.PropTypes.String, default: '#FF00FF' },
    Vehicle6: { type: hz.PropTypes.Entity },  Vehicle6Color: { type: hz.PropTypes.String, default: '#00FFFF' },
    Vehicle7: { type: hz.PropTypes.Entity },  Vehicle7Color: { type: hz.PropTypes.String, default: '#FFA500' },
    Vehicle8: { type: hz.PropTypes.Entity },  Vehicle8Color: { type: hz.PropTypes.String, default: '#800080' },

    // Racetrack corners
    TrackCorner1: { type: hz.PropTypes.Entity },
    TrackCorner2: { type: hz.PropTypes.Entity },
    TrackCorner3: { type: hz.PropTypes.Entity },
    TrackCorner4: { type: hz.PropTypes.Entity },

    // Map background asset
    mapBackgroundAssetId: { type: hz.PropTypes.String, default: '1961935444377212' },

    // Update rate limiting
    updateInterval: { type: hz.PropTypes.Number, default: 0.25 },
  };

  private mapDots: MapDot[] = [];
  private mapCanvas!: ui.UINode;
  private lastUpdateTime = 0;

  initializeUI(): ui.UINode {
    const assetId = BigInt(this.props.mapBackgroundAssetId);
    const mapTexture = ImageSource.fromTextureAsset(new TextureAsset(assetId));
    const mapBackground = ui.Image({
      source: mapTexture,
      style: {
        width: this.props.mapWidth,
        height: this.props.mapHeight,
        position: 'absolute' as const,
        left: 0,
        top: 0,
      },
    });

    const vehicles = [
      { entity: this.props.Vehicle1, color: this.props.Vehicle1Color },
      { entity: this.props.Vehicle2, color: this.props.Vehicle2Color },
      { entity: this.props.Vehicle3, color: this.props.Vehicle3Color },
      { entity: this.props.Vehicle4, color: this.props.Vehicle4Color },
      { entity: this.props.Vehicle5, color: this.props.Vehicle5Color },
      { entity: this.props.Vehicle6, color: this.props.Vehicle6Color },
      { entity: this.props.Vehicle7, color: this.props.Vehicle7Color },
      { entity: this.props.Vehicle8, color: this.props.Vehicle8Color },
    ];

    const dotNodes: ui.UINode[] = [];

    for (const v of vehicles) {
      if (!v.entity) continue;

      const leftBinding = new ui.Binding(0);
      const topBinding = new ui.Binding(0);

      const node = ui.View({
        style: {
          width: 12,
          height: 12,
          backgroundColor: v.color,
          borderRadius: 6,
          position: 'absolute' as const,
          left: leftBinding,
          top: topBinding,
        },
      });

      this.mapDots.push({ node, vehicle: v.entity, color: v.color, leftBinding, topBinding });
      dotNodes.push(node);
    }

    const mapStyle: any = {
      width: this.props.mapWidth,
      height: this.props.mapHeight,
      position: 'absolute' as const,
    };

    switch (this.props.mapAnchor) {
      case 'top-left': mapStyle.left = this.props.mapOffsetX; mapStyle.top = this.props.mapOffsetY; break;
      case 'top-right': mapStyle.right = this.props.mapOffsetX; mapStyle.top = this.props.mapOffsetY; break;
      case 'bottom-left': mapStyle.left = this.props.mapOffsetX; mapStyle.bottom = this.props.mapOffsetY; break;
      case 'bottom-right': mapStyle.right = this.props.mapOffsetX; mapStyle.bottom = this.props.mapOffsetY; break;
      case 'center': mapStyle.left = '50%'; mapStyle.top = '50%'; mapStyle.transform = 'translate(-50%, -50%)'; break;
    }

    this.mapCanvas = ui.View({
      style: mapStyle,
      children: [mapBackground, ...dotNodes],
    });

    return this.mapCanvas;
  }

  start() {
    this.connectLocalBroadcastEvent(hz.World.onUpdate, () => {
      const now = Date.now() / 1000;
      if (now - this.lastUpdateTime >= this.props.updateInterval) {
        this.updateDotPositions();
        this.lastUpdateTime = now;
      }
    });
  }

  private updateDotPositions() {
    if (this.mapDots.length === 0) return; // No vehicles slotted in, nothing to update

    const W1 = this.props.TrackCorner1?.position?.get();
    const W2 = this.props.TrackCorner2?.position?.get();
    const W3 = this.props.TrackCorner3?.position?.get();

    // If any track corner is missing, skip updating
    if (!W1 || !W2 || !W3) return;

    const zoom = this.props.mapZoom ?? 1;
    const rotationRad = ((this.props.mapRotation ?? 0) * Math.PI) / 180;

    // Basis vectors for map coordinate transformation
    const X = { x: W2.x - W1.x, z: W2.z - W1.z };
    const Y = { x: W3.x - W1.x, z: W3.z - W1.z };

    const a = X.x, b = Y.x, c = X.z, d = Y.z;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-6) return; // Prevent division by zero

    const aI = d / det;
    const bI = -b / det;
    const cI = -c / det;
    const dI = a / det;

    const mapWidth = this.props.mapWidth ?? 400;
    const mapHeight = this.props.mapHeight ?? 400;
    const cx = mapWidth / 2;
    const cy = mapHeight / 2;

    for (const dot of this.mapDots) {
      const pos = dot.vehicle?.position?.get();
      if (!pos) continue; // Skip if vehicle is not fully initialized

      const dx = pos.x - W1.x;
      const dz = pos.z - W1.z;

      const u = aI * dx + bI * dz;
      const v = cI * dx + dI * dz;

      let mapX = mapWidth * u;
      let mapY = mapHeight * v;

      // Apply zoom relative to center
      mapX = (mapX - cx) * zoom + cx;
      mapY = (mapY - cy) * zoom + cy;

      // Apply rotation
      const rx = mapX - cx;
      const ry = mapY - cy;
      const cos = Math.cos(rotationRad);
      const sin = Math.sin(rotationRad);
      const rotX = rx * cos - ry * sin + cx;
      const rotY = rx * sin + ry * cos + cy;

      dot.leftBinding.set(rotX);
      dot.topBinding.set(rotY);
    }
  }
}

hz.Component.register(RK_MapUIManager);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// Start/Stop Race button script
/////////////////////////////////////////////////////////////////////////////////////////

class RK_StartRace extends Component<typeof RK_StartRace> {
  static propsDefinition = {
    debugMode: { type: PropTypes.Boolean, default: false },
    controllerEntity: { type: PropTypes.Entity }, // drag in your VWS_Racekit_Controller entity
    isStartButton: { type: PropTypes.Boolean, default: true }, // true=start, false=stop
    light1: { type: PropTypes.Entity },
    light2: { type: PropTypes.Entity },
    light3: { type: PropTypes.Entity },
    light4: { type: PropTypes.Entity },
    sound1: { type: PropTypes.Entity },
    sound2: { type: PropTypes.Entity },
	sound3: { type: PropTypes.Entity },
  };
  
  private isRunning: boolean = false;
  private remainingTime: number = 0;
  private updateSubscription: EventSubscription | null = null;

  private triggered8s: boolean = false;
  private triggered4s: boolean = false;
  private triggered3s: boolean = false;
  private triggered2s: boolean = false;
  private triggered1s: boolean = false;
  
  private raceActive: boolean = false;

  override preStart() {
    // Listen for the event, so we can block the countdown lights & sound from running again while a race is already active
    
    if (this.props.controllerEntity)
    {
      this.connectNetworkEvent(this.props.controllerEntity, RaceControlEvent, (data) => {
        if (this.props.debugMode) console.log('[RK_RaceController] Received race event', data);
        if (data.command == 'start') this.raceActive = true;
        if ((data.command == 'stop') || (data.command == 'finished')) this.raceActive = false;
      });
    }

    // Detect player entering the trigger (button)
    this.connectCodeBlockEvent(
      this.entity,
      CodeBlockEvents.OnPlayerEnterTrigger,
      (player: Player) => {
        if (!this.props.isStartButton) 
        {
            if (this.props.controllerEntity)
            {
                this.remainingTime = 0;
                if (this.props.debugMode) console.log("Stop button pressed, stop event sent to network");
                if (this.raceActive) this.sendNetworkEvent(this.props.controllerEntity, RaceControlEvent, { command: 'stop' });
            }
        }
        else
        {
            if (!this.raceActive) this.startCountdown();
        }
      }
    );
  }

  override start() {
    this.resetLights();
  }

  private startCountdown() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.remainingTime = 9;
    this.resetEventFlags();

    if (this.props.debugMode) console.log('[Race Button] Countdown started');

    this.updateSubscription = this.connectLocalBroadcastEvent(
      World.onUpdate,
      (data) => this.onUpdate(data.deltaTime)
    );
  }

  private onUpdate(deltaTime: number) {
    if (!this.isRunning) return;

    this.remainingTime -= deltaTime;

    if (this.remainingTime <= 9 && !this.triggered8s) {
      this.triggered8s = true;
	  this.props.sound3?.as(AudioGizmo)?.play();
      if (this.props.debugMode) console.log('[Race Button] Get Ready Sound Played');
    }

    if (this.remainingTime <= 4 && !this.triggered4s) {
      this.triggered4s = true;
      this.props.sound1?.as(AudioGizmo)?.play();
      this.props.light1?.visible.set(true);
      if (this.props.debugMode) console.log('[Race Button] 4s');
    }

    if (this.remainingTime <= 3 && !this.triggered3s) {
      this.triggered3s = true;
      this.props.sound1?.as(AudioGizmo)?.play();
      this.props.light2?.visible.set(true);
      if (this.props.debugMode) console.log('[Race Button] 3s');
    }

    if (this.remainingTime <= 2 && !this.triggered2s) {
      this.triggered2s = true;
      this.props.sound1?.as(AudioGizmo)?.play();
      this.props.light3?.visible.set(true);
      if (this.props.debugMode) console.log('[Race Button] 2s');
    }

    if (this.remainingTime <= 1 && !this.triggered1s) {
      this.triggered1s = true;
      this.props.sound2?.as(AudioGizmo)?.play();
      this.props.light4?.visible.set(true);
      if (this.props.debugMode) console.log('[Race Button] 1s');
    }

    if (this.remainingTime <= 0) {
      this.finishCountdown();
    }
  }

  private finishCountdown() {
    this.isRunning = false;

    if (this.updateSubscription) {
      this.updateSubscription.disconnect();
      this.updateSubscription = null;
    }

    this.resetLights();

    if (this.props.controllerEntity) {
      const command = this.props.isStartButton ? 'start' : 'stop';
      this.sendNetworkEvent(this.props.controllerEntity, RaceControlEvent, { command });
      if (this.props.debugMode) console.log(`[Race Button] Countdown finished ? sending '${command}' event from entity ${this.entity.id} to controller ${this.props.controllerEntity.id}`);
    }
  }

  private resetLights() {
    this.props.light1?.visible.set(false);
    this.props.light2?.visible.set(false);
    this.props.light3?.visible.set(false);
    this.props.light4?.visible.set(false);
  }

  private resetEventFlags() {
    this.triggered8s = false;
	this.triggered4s = false;
    this.triggered3s = false;
    this.triggered2s = false;
    this.triggered1s = false;
  }

  override dispose() {
    if (this.updateSubscription) {
      this.updateSubscription.disconnect();
    }
  }
}

Component.register(RK_StartRace);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// RotateCube script
/////////////////////////////////////////////////////////////////////////////////////////

export class RK_RotateCube extends Component<typeof RK_RotateCube> {
  static propsDefinition = {
    rotationSpeedX: { type: PropTypes.Number, default: 10 },
    rotationSpeedY: { type: PropTypes.Number, default: 20 },
    rotationSpeedZ: { type: PropTypes.Number, default: 30 },
  };

  override preStart() {
    this.connectLocalBroadcastEvent(World.onUpdate, (data) => this.onUpdate(data));
  }
  
  override start() {}

  private onUpdate(data: { deltaTime: number }) {
    const { deltaTime } = data;

    const deltaX = this.props.rotationSpeedX * deltaTime;
    const deltaY = this.props.rotationSpeedY * deltaTime;
    const deltaZ = this.props.rotationSpeedZ * deltaTime;

    const rotX = Quaternion.fromAxisAngle(Vec3.right, deltaX);
    const rotY = Quaternion.fromAxisAngle(Vec3.up, deltaY);
    const rotZ = Quaternion.fromAxisAngle(Vec3.forward, deltaZ);

    const deltaRotation = rotX.mul(rotY).mul(rotZ);
  
    const currentRotation = this.entity.rotation.get();
    const newRotation = currentRotation.mul(deltaRotation);

    this.entity.rotation.set(newRotation);
  }
}

Component.register(RK_RotateCube);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// PrizeTrigger script
/////////////////////////////////////////////////////////////////////////////////////////

class RK_PrizeTrigger extends hz.Component<typeof RK_PrizeTrigger> {
  static propsDefinition = {
    sound: { type: hz.PropTypes.Entity },
    mesh: { type: hz.PropTypes.Entity },
    respawnTime: { type: hz.PropTypes.Number, default: 30 }, // seconds
    debugMode: { type: hz.PropTypes.Boolean, default: false },
	vehicleScript:  { type: hz.PropTypes.Entity },
  };

  private active = true;

  start() {
    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnEntityEnterTrigger,
      (enteredBy: hz.Entity) => this.onTrigger(enteredBy)
    );
  }

  private onTrigger(triggeringEntity: hz.Entity) {
    if (!this.active) return;
    this.active = false;

    // Play sound
    const soundGizmo = this.props.sound?.as(hz.AudioGizmo);
    soundGizmo?.play();

    // Hide mesh
    if (this.props.mesh) this.props.mesh.visible.set(false);

   //  Pick random prize 1?5
    const prizeIndex = Math.floor(Math.random() * 5) + 1;

    // Send network message using the triggering entity as vehicleId
    const messageEvent = new hz.NetworkEvent<{ vehicleId: string; message: string }>(
      'CustomVehicleMessage'
    );
	
    this.sendNetworkEvent(triggeringEntity, messageEvent, {
      vehicleId: triggeringEntity.id.toString(), // bigint -> string
	  message: "prize" + prizeIndex.toString(),
    });

    if (this.props.debugMode) {
      console.log(`[RK_PrizeTrigger ${triggeringEntity.id}] Sent prize ${prizeIndex}`);
    }

    // Respawn mesh after delay
    this.async.setTimeout(() => {
      this.active = true;
      if (this.props.mesh) this.props.mesh.visible.set(true);
      if (this.props.debugMode) {
        console.log(`[RK_PrizeTrigger ${triggeringEntity.id}] Respawned`);
      }
    }, this.props.respawnTime! * 1000);
  }
}

hz.Component.register(RK_PrizeTrigger);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// ProjectileSpawner script
/////////////////////////////////////////////////////////////////////////////////////////

export class RK_ProjectileSpawner extends Component<typeof RK_ProjectileSpawner> {
  static propsDefinition = {
    debugMode: { type: PropTypes.Boolean },
    prefab1: { type: PropTypes.Asset },
    prefab1Velocity: { type: PropTypes.Number, default: 60 },

    prefab2: { type: PropTypes.Asset },
    prefab2Velocity: { type: PropTypes.Number, default: 60 },

    prefab3: { type: PropTypes.Asset },
    prefab3Velocity: { type: PropTypes.Number, default: 0 },

    prefab4: { type: PropTypes.Asset },
    prefab4Velocity: { type: PropTypes.Number, default: 65 },

    prefab5: { type: PropTypes.Asset },
    prefab5Velocity: { type: PropTypes.Number, default: 0 },

	vehicleScript: { type: PropTypes.Entity },

    destroyTimeout: { type: PropTypes.Number, default: 30 }, // seconds
  };

  prefabs: (Asset | null)[] = [];
  private velocities: number[] = [];
  private destroyedEntities = new Set<PhysicalEntity>();

  override start() {
    this.prefabs = [
      this.props.prefab1!,
      this.props.prefab2!,
      this.props.prefab3!,
      this.props.prefab4!,
      this.props.prefab5!
    ];

    this.velocities = [
      this.props.prefab1Velocity!,
      this.props.prefab2Velocity!,
      this.props.prefab3Velocity!,
      this.props.prefab4Velocity!,
      this.props.prefab5Velocity!
    ];
  }

  override preStart() {
    // Must attach the listener to an entity (cannot use null)
    this.connectNetworkEvent(this.entity, CustomVehicleMessage, (data) => {
      if (this.props.debugMode == true) console.log(`[${this.vehicleId}] Received message:`, data);
      this.handleMessage(data);
    });
  }

  private vehicleId = "123"; //for internal use only, more like a group for vehicles in this instance


  private vehvel: Vec3 = new Vec3(0,0,0);
  private vehavel: Vec3 = new Vec3(0,0,0);

  private async handleMessage(data: { vehicleId: string; message: string }) {
    if (data.vehicleId !== this.vehicleId) return;

    const index = parseInt(data.message) - 1;
    if (index < 0 || index >= this.prefabs.length) return;

    const prefab = this.prefabs[index];
    if (!prefab) return;

    if (this.props.debugMode) {
      console.log(`[${this.vehicleId}] Spawning prefab ${index + 1}`);
    }

    const entities = await this.world.spawnAsset(
      prefab,
      this.entity.position.get(),
      this.entity.rotation.get()
    );
    if (entities.length === 0) return;

    const spawnedEntity = entities[0].as(PhysicalEntity);
    spawnedEntity.interactionMode.set(EntityInteractionMode.Physics);

    const vehicle = this.props.vehicleScript?.as(PhysicalEntity);
    if (vehicle) {
      this.vehvel = vehicle.velocity.get();
      this.vehavel = vehicle.angularVelocity.get();

      // Inherit vehicle linear motion
      spawnedEntity.applyForce(this.vehvel, PhysicsForceMode.Impulse);

      // Inherit vehicle angular motion
      spawnedEntity.applyTorque(this.vehavel);
    }

    // Add forward impulse
    const forward = this.entity.forward.get().normalize();
    const impulse = forward.mul(this.velocities[index]);
    spawnedEntity.applyForce(impulse, PhysicsForceMode.Impulse);

    // Track entity for safe deletion
    this.destroyedEntities.add(spawnedEntity);

    // Auto-destroy after timeout
    this.async.setTimeout(() => {
      if (!this.destroyedEntities.has(spawnedEntity)) return; // already deleted
      try {
        if (spawnedEntity.exists()) {
          this.world.deleteAsset(spawnedEntity, true);
          this.destroyedEntities.delete(spawnedEntity);
          if (this.props.debugMode) {
            console.log(
              `[${this.vehicleId}] Prefab auto-destroyed after ${this.props.destroyTimeout}s`
            );
          }
        }
      } catch (e) {
        console.warn(`[${this.vehicleId}] Failed to destroy prefab:`, e);
      }
    }, this.props.destroyTimeout! * 1000);
  }

}

Component.register(RK_ProjectileSpawner);


/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// ProjectileCollision script
/////////////////////////////////////////////////////////////////////////////////////////

class RK_ProjectileCollision extends hz.Component<typeof RK_ProjectileCollision> {
  static propsDefinition = {
    audio: { type: hz.PropTypes.Entity },
    particleEffect: { type: hz.PropTypes.Entity },
    delay: { type: hz.PropTypes.Number, default: 1 },
  };

  private destroyed = false; // track if already deleted

  start() {
    // Connect to the OnEntityCollision event
    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnEntityCollision,
      this.onCollision.bind(this)
    );
  }

  private onCollision(collidedWith: hz.Entity) {
    // Play audio effect safely
    this.props.audio?.as(hz.AudioGizmo)?.play();

    // Play particle effect safely
    this.props.particleEffect?.as(hz.ParticleGizmo)?.play();

    // Delete the projectile after a delay
    this.async.setTimeout(() => {
      if (this.destroyed) return; // prevent double deletion
      try {
        this.world.deleteAsset(this.entity, true);
        this.destroyed = true;
      } catch (e) {
        console.warn("Failed to delete projectile:", e);
      }
    }, this.props.delay! * 1000);
  }
}

hz.Component.register(RK_ProjectileCollision);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// ResetTriggerRelay script
// Sends a "reset" message with the entity id, trigger position, and rotation to the RaceController
/////////////////////////////////////////////////////////////////////////////////////////

class RK_ResetTriggerRelay extends hz.Component<typeof RK_ResetTriggerRelay> {
  static propsDefinition = {
    debugMode: { type: hz.PropTypes.Boolean, default: true },

    trigger1: { type: hz.PropTypes.Entity },
    trigger2: { type: hz.PropTypes.Entity },
    trigger3: { type: hz.PropTypes.Entity },
    trigger4: { type: hz.PropTypes.Entity },
    trigger5: { type: hz.PropTypes.Entity },
    trigger6: { type: hz.PropTypes.Entity },
    trigger7: { type: hz.PropTypes.Entity },
    trigger8: { type: hz.PropTypes.Entity },
    trigger9: { type: hz.PropTypes.Entity },
    trigger10: { type: hz.PropTypes.Entity },

    vehicleTag: { type: hz.PropTypes.String, default: 'vehicle' },
    raceController: { type: hz.PropTypes.Entity },
  };

  private triggers: hz.Entity[] = [];

  override start() {
    // Gather all non-null triggers
    this.triggers = [
      this.props.trigger1,
      this.props.trigger2,
      this.props.trigger3,
      this.props.trigger4,
      this.props.trigger5,
      this.props.trigger6,
      this.props.trigger7,
      this.props.trigger8,
      this.props.trigger9,
      this.props.trigger10,
    ].filter(Boolean) as hz.Entity[];

    // Connect events for each trigger
    this.triggers.forEach((trig, i) => {
      this.connectCodeBlockEvent(
        trig,
        hz.CodeBlockEvents.OnEntityEnterTrigger,
        (entity: hz.Entity) => this.onTriggerEnter(entity, trig)
      );
      if (this.props.debugMode)
        if (this.props.debugMode) console.log(`[RK_ResetTriggerRelay] Connected trigger ${i} (${trig.id})`);
    });
  }

  private onTriggerEnter(entity: hz.Entity, trigger: hz.Entity) {
    // Only act if entity has the specified tag
    if ((!entity.tags) || (!entity.tags.get().includes(this.props.vehicleTag))) return;

    if (this.props.debugMode) console.log(`[RK_ResetTriggerRelay] Entity ${entity.id} entered trigger ${trigger.id}, sending reset`);

    // Send the reset event to the race controller
    if (this.props.raceController) {
      this.sendNetworkEvent(this.props.raceController, ResetEvent, {
        entityId: entity.id.toString(),
        command: 'reset',
        triggerPosition: trigger.position.get(), // hz.Vec3
        triggerRotation: trigger.rotation.get(), // hz.Quaternion
      });
    }
  }
}

hz.Component.register(RK_ResetTriggerRelay);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// Leaderboard controller script
// Sends messages received at the end of race for adding individual players to the 
// Leaderboard Gizmo
/////////////////////////////////////////////////////////////////////////////////////////

class RK_LeaderboardUpdater extends hz.Component<typeof RK_LeaderboardUpdater> {
  static execution = 'server'; // server/host
  static propsDefinition = {
    leaderboardName: { type: hz.PropTypes.String, default: "MyLeaderBoard" },
    debugMode: { type: hz.PropTypes.Boolean, default: true },
    raceManager: { type: hz.PropTypes.Entity },
  };

  start() {
    this.connectNetworkEvent(this.entity, playerLBEvent, (data: { playerId: number; seconds: number }) => {
      const player = this.world.getPlayers().find(p => p.id === data.playerId);
      if (player) {
        // Use the seconds as the score
        this.SetLeaderboard(this.props.leaderboardName, player, data.seconds, true);
        if (this.props.debugMode) console.log(`Success setting leaderboard for player ${data.playerId}: ${data.seconds} seconds`);
      } else {
        if (this.props.debugMode) console.log("Player not found, id: " + data.playerId);
      }
      
      // --- send TeleportPlayerEvent here bc they finished the race ---
      if ((this.props.raceManager) && (player)) {
        this.sendNetworkEvent(this.props.raceManager, TeleportPlayerEvent, { playerId: player.id.toString() });
        if (this.props.debugMode) console.log(`[Leaderboard] Sent TeleportPlayerEvent for player ${player.id}`);
      }
      
    });
  }

  SetLeaderboard(leaderboardName: string, p: hz.Player, score: number, override: boolean) {
    if (this.props.debugMode) console.log(`SetLeaderboard called: ${leaderboardName}, ${p.id}, ${score}`);
    this.world.leaderboards.setScoreForPlayer(leaderboardName, p, score, override);
  }
}

hz.Component.register(RK_LeaderboardUpdater);

const RaceJoinEvent = new hz.NetworkEvent<{ playerIndex: number }>('RaceJoinEvent');

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// RaceManager script
// Managers player entry and exit upon race finish/end from racing area
/////////////////////////////////////////////////////////////////////////////////////////

class RK_RaceManager extends hz.Component<typeof RK_RaceManager> {
  static executionMode = 'server';

  static propsDefinition = {
    debugMode: { type: hz.PropTypes.Boolean, default: true },
    returnSlot: { type: hz.PropTypes.Entity }, // where players return after race
    trackSlot: { type: hz.PropTypes.Entity },  // where players spawn at race start
    maxPlayers: { type: hz.PropTypes.Number, default: 8 },
    raceController: { type: hz.PropTypes.Entity },
    leaderboardManager: { type: hz.PropTypes.Entity },
  };

  private playersInRace: Map<string, Player> = new Map();
  private raceActive = false;

  override start() {
    if (this.props.debugMode) console.log('[RK_RaceManager] Initialized');

    // Listen for join requests from buttons
    this.connectNetworkEvent(this.entity, RaceJoinEvent, (data: { playerIndex: number }) =>
        this.onPlayerJoin(data)
    );

    // Listen to race controller start/stop events
    if (this.props.raceController) {
        this.connectNetworkEvent(
            this.props.raceController,
            RaceControlEvent,
            (data) => {
                if (data.command === 'start') this.onRaceStart();
                if (data.command === 'stop') this.onRaceStop();
                if (data.command === 'finished') this.onRaceStop();
            }
        );
    }

    // Listen for TeleportPlayerEvent from leaderboard manager
    if (this.props.leaderboardManager) {
        this.connectNetworkEvent(
            this.entity,
            TeleportPlayerEvent,
            (data: { playerId: string }) => {
                if (this.props.debugMode) console.log("Received TeleportPlayerEvent on RaceManager");
                const playerId = data.playerId;
                const player = this.world.getPlayers().find(p => p.id.toString() === playerId);
                if (!this.props.returnSlot) {
                    if (this.props.debugMode) console.warn(`[TeleportPlayerEvent] returnSlot not set; cannot teleport player ${data.playerId}`);
                    return;
                }

                const pos = this.props.returnSlot.position.get();
                try {
                    const pos = this.props.returnSlot.position.get(); // returns a Vec3
                    const yOffset = 15;
                    const newPos = pos.clone();
                    newPos.y += yOffset;
                    player?.position.set(newPos);

                    if (this.props.debugMode) console.log(`[TeleportPlayerEvent] Player ${data.playerId} teleported to returnSlot`);
                } catch (e) {
                    if (this.props.debugMode) console.warn(`[TeleportPlayerEvent] Failed to teleport player ${data.playerId}`, e);
                }
            }
        );

        if (this.props.debugMode) console.log(`[EntryController] Listening to TeleportPlayerEvent from leaderboardManager`);
    }
  }

  private onPlayerJoin(data: { playerIndex: number }) {
    const player = this.world.getPlayerFromIndex(data.playerIndex);
    if (!player) {
      if (this.props.debugMode) console.warn(`No player exists at index: ${data.playerIndex}`);
      return;
    }

    const playerId = player.id.toString();

    if (this.raceActive) {
      if (this.props.debugMode) console.log(`[RK_RaceManager] Race active, rejecting ${playerId}`);
      return;
    }

    if (this.playersInRace.size >= (this.props.maxPlayers ?? 8)) {
      if (this.props.debugMode) console.log(`[RK_RaceManager] Race full, rejecting ${playerId}`);
      return;
    }

    if (this.playersInRace.has(playerId)) {
      if (this.props.debugMode) console.log(`[RK_RaceManager] Player ${playerId} already in race`);
      return;
    }

    this.playersInRace.set(playerId, player);
    if (this.props.debugMode) console.log(`[RK_RaceManager] Player ${playerId} added to race (total ${this.playersInRace.size})`);

    // Teleport to trackSlot immediately
    if (this.props.trackSlot) {
      const trackPos = this.props.trackSlot.position.get();
      try {
        player.position.set(trackPos);
        if (this.props.debugMode) console.log(`[RK_RaceManager] Player ${playerId} teleported to trackSlot`);
      } catch (e) {
        if (this.props.debugMode) console.warn(`[RK_RaceManager] Failed to teleport player ${playerId}`, e);
      }
    }
  }

  public onRaceStart() {
    this.raceActive = true;
    if (this.props.debugMode) console.log('[RK_RaceManager] Race started');
  }

  public onRaceStop() {
    this.raceActive = false;
    if (this.props.debugMode) console.log('[RK_RaceManager] Race stopped — returning players');

    if (!this.props.returnSlot) {
      if (this.props.debugMode) console.warn('[RK_RaceManager] returnSlot not set; clearing players');
      this.playersInRace.clear();
      return;
    }

    const pos = this.props.returnSlot.position.get();

    this.playersInRace.forEach((player, playerId) => {
      try {
        player.position.set(pos);
        if (this.props.debugMode) console.log(`[RK_RaceManager] Player ${playerId} returned to returnSlot`);
      } catch (e) {
        if (this.props.debugMode) console.warn(`[RK_RaceManager] Failed to return player ${playerId}`, e);
      }
    });    

    this.playersInRace.clear();
    if (this.props.debugMode) console.log('[RK_RaceManager] Cleared playersInRace map');
  }
}

hz.Component.register(RK_RaceManager);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// RK_LiveLeaderboard
// 
// LiveLeaderBoard, goes on a UI gizmo to show spectators who is in what position in 
// the current race only
/////////////////////////////////////////////////////////////////////////////////////////

type LeaderboardRow = {
    playerName: ui.Binding<string>;
    position: ui.Binding<string>;
    texture: ui.Binding<ui.ImageSource | null>;
    opacity: ui.Binding<number>;
};

export class RK_LiveLeaderboard extends ui.UIComponent<typeof RK_LiveLeaderboard> {
    static executionMode = 'server';

    static propsDefinition = {
        maxRows: { type: PropTypes.Number, default: 8 },
        texWidth: { type: PropTypes.Number, default: 50 },
        texHeight: { type: PropTypes.Number, default: 37.5 },
        rowHeight: { type: PropTypes.Number, default: 37.5 },
        debugMode: { type: PropTypes.Boolean, default: false },
        texture0: { type: PropTypes.String, default: '0' },
        texture1: { type: PropTypes.String, default: '0' },
        texture2: { type: PropTypes.String, default: '0' },
        texture3: { type: PropTypes.String, default: '0' },
        texture4: { type: PropTypes.String, default: '0' },
        texture5: { type: PropTypes.String, default: '0' },
        texture6: { type: PropTypes.String, default: '0' },
        texture7: { type: PropTypes.String, default: '0' },
        texture8: { type: PropTypes.String, default: '0' },
    };

    private leaderboardRows: LeaderboardRow[] = [];
    private overlayNode!: ui.UINode;

    // Store latest leaderboard snapshot
    private playerEntries: { playerId: string; playerName: string; textureIndex?: number; position: number }[] = [];

    private leaderboardUpdateEvent = new NetworkEvent<{
        leaderboard: { playerId: string; playerName: string; textureIndex?: number; position: number }[];
    }>('PlayerLeaderboardUpdateEvent');

    private updateLeaderboardUI() {
        // Sort player entries by position ascending
        const sortedEntries = [...this.playerEntries].sort((a, b) => a.position - b.position);

        for (let i = 0; i < this.leaderboardRows.length; i++) {
            const row = this.leaderboardRows[i];
            const entry = sortedEntries[i];

            if (!entry) {
                row.playerName.set('');
                row.position.set('');
                row.texture.set(null);
                row.opacity.set(0);
                continue;
            }

            row.playerName.set(entry.playerName);
            row.position.set(''); // hide numeric text, we only want the graphic

            // Use **position to select texture**: 1 → texture1, 2 → texture2, etc.
            const texture = this.getImageSourceByPosition(entry.position);
            row.texture.set(texture);

            row.opacity.set(1);
        }
    }

    // Helper to map leaderboard position to texture
    private getImageSourceByPosition(position: number): ui.ImageSource | null {
        const textureIds = [
            this.props.texture1, this.props.texture2, this.props.texture3,
            this.props.texture4, this.props.texture5, this.props.texture6,
            this.props.texture7, this.props.texture8,
        ];
        if (position < 1 || position > textureIds.length) return null;
        const id = textureIds[position - 1]; // 1 → texture1, 2 → texture2
        if (!id || id === '0') return null;
        const asset = new TextureAsset(BigInt(id));
        return ui.ImageSource.fromTextureAsset(asset);
    }
	
    override start()
	{
      // Initialize all rows with empty values on startup...
	  
      this.async.setTimeout(() => {
        for (const row of this.leaderboardRows) {
          row.playerName.set('');
          row.position.set('');
          row.texture.set(0);
          row.opacity.set(0);
        }	
		this.updateLeaderboardUI();
      }, 5000);
	}

    override preStart() {
        this.connectNetworkEvent(this.entity, this.leaderboardUpdateEvent, (data) => {
            const resolvedLeaderboard = data.leaderboard
                // only keep entries for actual players
                .map(entry => {
                    const player = this.world.getPlayers().find(p => p.id.toString() === entry.playerId);
                    if (!player) return null; // filter out unoccupied cars
                  const safeName = String(player.name.get() ?? '').trim();
                  return {
                      ...entry,
                      playerName: "    " + safeName
                  };
                })
                .filter((entry): entry is { playerId: string; playerName: string; textureIndex?: number; position: number } => entry !== null);

            this.playerEntries = resolvedLeaderboard;
            this.updateLeaderboardUI();
        });
    }

    initializeUI(): ui.UINode {
        const rows: ui.UINode[] = [];

        for (let i = 0; i < this.props.maxRows; i++) {
            const playerName = new ui.Binding<string>('');
            const position = new ui.Binding<string>('');
            const opacity = new ui.Binding<number>(0);
            const texture = new ui.Binding<ui.ImageSource | null>(null);

            this.leaderboardRows.push({ playerName, position, texture, opacity });

            rows.push(
                ui.View({
                    style: {
                        flexDirection: 'row',
                        height: this.props.rowHeight,
                        alignItems: 'center',
                        paddingHorizontal: 0,
                    },
                    children: [
                        ui.Image({
                            source: texture,
                            style: {
                                width: this.props.texWidth,
                                height: this.props.rowHeight,
                                opacity,
                            },
                        }),
                        ui.Text({
                            text: playerName,
                            style: { flex: 1, color: 'white', fontSize: 30 },
                        }),
                    ],
                })
            );
        }

        this.overlayNode = ui.View({
            style: {
                position: 'absolute',
                top: 20,
                right: 20,
                height: 600,
                width: 400,
                backgroundColor: '#0008',
                padding: 0,
                borderRadius: 6,
            },
            children: rows,
        });

        return this.overlayNode;
    }
}
hz.Component.register(RK_LiveLeaderboard);

/////////////////////////////////////////////////////////////////////////////////////////
// RK_TeleportPlayer
// This component teleports a player to a specified world position when hit the trigger
/////////////////////////////////////////////////////////////////////////////////////////

class RK_TeleportPlayer extends hz.Component<typeof RK_TeleportPlayer> {
  static propsDefinition = {
    // The world position to teleport the player to.
    targetPosition: { type: hz.PropTypes.Vec3 },
    // The trigger entity that triggers the teleportation.
    trigger: { type: hz.PropTypes.Entity },
  };

  start() {
    // Check if the trigger entity is valid.
    if (!this.props.trigger!) {
      console.error('Trigger entity is not set.');
      return;
    }

    // Cast the trigger entity to a TriggerGizmo.
    const triggerGizmo = this.props.trigger!.as(hz.TriggerGizmo);
    if (!triggerGizmo) {
      console.error('Trigger entity is not a TriggerGizmo.');
      return;
    }

    // Connect to the OnPlayerEnterTrigger event.
    this.connectCodeBlockEvent(triggerGizmo, hz.CodeBlockEvents.OnPlayerEnterTrigger, this.onPlayerEnterTrigger.bind(this));
  }

  onPlayerEnterTrigger(player: hz.Player) {
    // Teleport the player to the target position.
    player.position.set(this.props.targetPosition!);
  }
}

hz.Component.register(RK_TeleportPlayer);

/////////////////////////////////////////////////////////////////////////////////////////
// RK_AvatarPoseGizmoController
// Controls ownership of the 3 child objects in the vehicles when and goes directly on
// the AvatarPoseGizmo (Sitpoint) child object in the vehicle, and needs the 
// RK_RacePositionOverlay, RK_PrizeBar objects as well as the vehicle root linked in on 
// this script in the inspector, as well as the AvatarPoseGizmo itself 
/////////////////////////////////////////////////////////////////////////////////////////

class RK_AvatarPoseGizmoController extends hz.Component<typeof RK_AvatarPoseGizmoController> {
  static propsDefinition = {
    avatarPoseGizmo: { type: PropTypes.Entity },
    vehicleScript: { type: PropTypes.Entity },
    positionOverlayScript: { type: PropTypes.Entity },
    prizeBarScript: { type: PropTypes.Entity }
  };
  
  override preStart() {
    const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);
    
    if (this.props.avatarPoseGizmo)
    {
        if (gizmo) gizmo.exitAllowed.set(false);

        // Setup sitpoint enter
        this.connectCodeBlockEvent(
            this.props.avatarPoseGizmo,
            CodeBlockEvents.OnPlayerEnterAvatarPoseGizmo,
            (player: Player) => this.onPlayerEnter(player),
        );

        // Setup sitpoint exit
        this.connectCodeBlockEvent(
            this.props.avatarPoseGizmo,
            CodeBlockEvents.OnPlayerExitAvatarPoseGizmo,
            (player: Player) => this.onPlayerExit(player),
        );
    }
  }  

  start() {
  }

  private onPlayerEnter(player: Player) {
    const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);
    if (gizmo) 
    {    
      this.props.vehicleScript?.owner.set(player);
      this.props.prizeBarScript?.owner.set(player);    
    }

    if (this.props.vehicleScript)
	{
	  this.sendNetworkEvent(this.props.vehicleScript, VehicleOccupantEvent, { 
        vehicleId: this.entity.id, 
        playerId: player.id 
      });
	}
  }
  
  private onPlayerExit(player: Player) {
    if (this.props.vehicleScript)
	{
	  this.sendNetworkEvent(this.props.vehicleScript, VehicleOccupantEvent, { 
	    vehicleId: this.entity.id, 
	    playerId: 0
      });
	}
  }
}

hz.Component.register(RK_AvatarPoseGizmoController);
