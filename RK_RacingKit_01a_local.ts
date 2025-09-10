/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons - v0.1a
// by free.light - 08/2025 - 09/2025 - iamfreelight@gmail.com
/////////////////////////////////////////////////////////////////////////////////////////

import * as ui from 'horizon/ui';
import { ImageSource } from 'horizon/ui';
import * as hz from 'horizon/core';
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
  EntityRaycastHit,
  RaycastTargetType,
  BaseRaycastHit
} from 'horizon/core';

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

const syncTimeEvent = new hz.NetworkEvent('syncTime');

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// Main Vehicle Script
/////////////////////////////////////////////////////////////////////////////////////////

import LocalCamera, { CameraTransitionOptions, Easing } from 'horizon/camera';

type VehicleState = {
  elapsedTime: number;
  currentRaceActive: boolean;
  raceStartTime: number | null;
  prevRaceActive: boolean;
  initialPosition?: {x: number, y: number, z: number};
  initialRotation?: {x: number, y: number, z: number, w: number};
  wheelInitialRotations?: Record<string, {x: number, y: number, z: number, w: number}>;
  steeringInitialRot?: {x: number, y: number, z: number, w: number};
};

export class RK_VehicleScript_1a extends Component<typeof RK_VehicleScript_1a, VehicleState> {
  static executionMode = 'local';

  static propsDefinition = {
    debugMode: { type: PropTypes.Boolean },
    speed: { type: PropTypes.Number, default: 1 },
    maxVelocity: { type: PropTypes.Number, default: 20 },    
    turnspeed: { type: PropTypes.Number, default: 1 },
    mobileTurnSpeed: { type: PropTypes.Number, default: 0.4 },
    minAngularVelocity: { type: PropTypes.Number, default: -1 },
    maxAngularVelocity: { type: PropTypes.Number, default: 1 },    
    lateralGrip: { type: PropTypes.Number, default: 0.85 },
    lateralGripCutoff: { type: PropTypes.Number, default: 0.1 },
    minFriction: { type: PropTypes.Number, default: 0.98 },
    maxFriction: { type: PropTypes.Number, default: 10 },
    applyLocalForce: { type: PropTypes.Boolean },
    applyLocalTorque: { type: PropTypes.Boolean },  
    avatarPoseGizmo: { type: PropTypes.Entity },
    raycastGizmo: { type: PropTypes.Entity },
    rcDown: { type: PropTypes.Vec3, default: new Vec3(0, -1, 0) },
    rcForward: { type: PropTypes.Vec3, default: new Vec3(0, 0, 1) },
    groundCheckDistance: { type: PropTypes.Number, default: 2.0 },
    engineSound: { type: PropTypes.Entity },
    crashSound: { type: PropTypes.Entity },
    boostSound: { type: PropTypes.Entity },
    beepSound: { type: PropTypes.Entity },  
    pitchFactor: { type: PropTypes.Number, default: 0.02 },
    sittingTransform: { type: PropTypes.Entity },
    exitTransform: { type: PropTypes.Entity },
    smokeParticleFx1: { type: PropTypes.Entity },
    smokeParticleFx2: { type: PropTypes.Entity },
    smokeThreshold: { type: PropTypes.Number },  
    trailFx1: { type: PropTypes.Entity },
    trailFx2: { type: PropTypes.Entity },
    trailsThreshold: { type: PropTypes.Number },
    hitSparkParticleFx: { type: PropTypes.Entity },
    boostParticleFx: { type: PropTypes.Entity },
    boostTrailFx: { type: PropTypes.Entity },
    frontLeftWheel: { type: PropTypes.Entity },
    frontRightWheel: { type: PropTypes.Entity },
    rearLeftWheel: { type: PropTypes.Entity },
    rearRightWheel: { type: PropTypes.Entity },
    wheelSpinSpeed: { type: PropTypes.Number, default: 5 },
    steeringWheel: { type: PropTypes.Entity },
    steeringWheelAxis: { type: PropTypes.String, default: 'y' },
    steeringWheelTilt: { type: PropTypes.Number, default: 0 },
    
    camAttachPositionOffset1: { type: hz.PropTypes.Vec3, default: new hz.Vec3(0, 0.75, -3.0) },
    camAttachPositionOffset2: { type: hz.PropTypes.Vec3, default: new hz.Vec3(0, 1.0, -7.0) },
    camAttachPositionOffset3: { type: hz.PropTypes.Vec3, default: new hz.Vec3(0, 1.5, -10.0) },
    camRotationSpeed: { type: hz.PropTypes.Number, default: 2 },
    
    camOrbitVerticalOffset: { type: PropTypes.Number, default: 2 }, 
    camOrbitRotationSpeed: { type: PropTypes.Number, default: 2 }, 
    camOrbitDistance: { type: PropTypes.Number, default: 2 }, 
    camOrbitTranslationSpeed: { type: PropTypes.Number, default: 2 }, 
    easeSpeed: { type: hz.PropTypes.Number, default: 0.5 },
    
    gripPoseDriving: {type: PropTypes.String, default: 'Driving'},
    PrizeBarEntity: { type: PropTypes.Entity },
    RaceStatsEntity: { type: PropTypes.Entity },

    flusteredRotationSpeed: { type: PropTypes.Number, default: 5 },    
    flusteredRotationTime: { type: PropTypes.Number, default: 5 },    

    flattenedTime: { type: PropTypes.Number, default: 5 },    

    launchSpeed: { type: PropTypes.Number, default: 5 },
    launchTime: { type: PropTypes.Number, default: 5 },
    
    boostTime: { type: PropTypes.Number, default: 5 },    
    boostSpeedIncrease: { type: PropTypes.Number, default: 10 },
    
    HitBoxTrigger: { type: PropTypes.Entity }
  };

  private physicalEntity!: PhysicalEntity;
  private sittingPlayerId?: number = 0;

  private jumpInput?: PlayerInput;
  private leftXAxisInput?: PlayerInput;
  private leftYAxisInput?: PlayerInput;
  private beepInput?: PlayerInput;
  
  private leftJoystickInput!: PlayerInput; //for mobile controls

  private axisX = 0;
  private axisY = 0;

  private isGrounded: boolean = false;
  private wasGrounded: boolean = true;
  private raycastGizmo?: RaycastGizmo;

  private initialPosition!: Vec3;
  private initialRotation!: Quaternion;

  private audioGizmo?: AudioGizmo;
  private beepAudioGizmo?: AudioGizmo;
  private crashAudioGizmo?: AudioGizmo;
  private boostAudioGizmo?: AudioGizmo;
  
  private audioLoopSubscription?: EventSubscription;
  
  private lastBeepTime: number = 0;
  private beepCooldown: number = 1.0; // 1 second cooldown for beep
  private lastParticleTime: number = 0;
  private particleCooldown: number = 0.5; // 0.5 second cooldown for particle FX
  private lastTrailTime: number = 0;
  private trailCooldown: number = 0.5; // 0.5 second cooldown for trail FX

  private frontLeftWheel?: PhysicalEntity;
  private frontRightWheel?: PhysicalEntity;
  private rearLeftWheel?: PhysicalEntity;
  private rearRightWheel?: PhysicalEntity;
  private steeringWheelEntity?: PhysicalEntity;  
  
  private wheelInitialRotations: Map<PhysicalEntity, Quaternion> = new Map();  
  
  private vehicleId: string = "123";
  
  private spinningOutEnabled: boolean = false;
  
  private launchingUpEnabled: boolean = false;  
  private launchTime: number = 0;
  
  private flattenEnabled: boolean = false;
  
  private boostTotal = 0;

  private DriverPlayerId = -1;
  
  private wheelData: {
    entity: PhysicalEntity;
    initialRot: Quaternion;
    spinAxis: 'x'|'y'|'z';
    steerAxis?: 'x'|'y'|'z';
    isSteering?: boolean;
  }[] = [];

  private steeringWheelData?: {
    entity: PhysicalEntity;
    initialRot: Quaternion;
    steerAxis: 'x'|'y'|'z';
  };  
  
    private cameraModes = [
    'thirdperson',
    'firstperson',
    'attach1',
    'attach2',
    'attach3',
    'orbit',
  ] as const;

  private currentCameraIndex = 0;
  private cameraInput?: PlayerInput;

  private overlayVisible = new ui.Binding<boolean>(false); 
  private prizeQuantities: number[] = [0, 0, 0, 0, 0]; 
  private prizeBindings: ui.Binding<string>[] = []; 
  private imageOpacityBindings: ui.Binding<number>[] = []; 
  private borderBindings: ui.Binding<string>[] = [];
  
  private currentPosition: number = 0; // current position in the race for this vehicle
  private currentLap: number = 0;
  private currentLapCount: number = 3;
  private currentRaceActive: boolean = false;
  private finished: boolean = false;
  
  // state
  private raceStartTime: number | null = null;

  private elapsedTime: number = 0;              // accumulated seconds  
  
  private leaderboardEntities?: Entity[];  
  private setLeaderboardForThisFinish: boolean = false;

  private isTeleporting: boolean = false;
  private teleportTimer: number = 0;

  private serverTime!: number;
  private clientTime!: number;  
  
  updateServerTime(data: { timestamp: number }) {
    this.serverTime = data.timestamp;
    this.clientTime = Date.now();
  }

  getCurrentTime(): number {
    if (this.serverTime === undefined || isNaN(this.serverTime)) {
      return Date.now();
    }
    const timeDiff = Date.now() - this.clientTime;
    return this.serverTime + timeDiff;
  }

  override preStart() {
    this.connectNetworkBroadcastEvent(syncTimeEvent, this.updateServerTime.bind(this));

    const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);

    this.raycastGizmo = this.props.raycastGizmo?.as(RaycastGizmo);
    this.isGrounded = true;

    gizmo?.exitAllowed.set(false);
    
    if (gizmo)
    {
      // Setup sitpoint enter
      this.connectCodeBlockEvent(
        gizmo,
        CodeBlockEvents.OnPlayerEnterAvatarPoseGizmo,
        (player: Player) => this.onPlayerEnter(player),
      );

      // Setup sitpoint exit
      this.connectCodeBlockEvent(
        gizmo,
        CodeBlockEvents.OnPlayerExitAvatarPoseGizmo,
        (player: Player) => this.onPlayerExit(player),
      );
    }

    // Setup engine sound
    if (this.props.engineSound) {
      this.audioGizmo = this.props.engineSound.as(AudioGizmo);

      if (this.audioGizmo) {
        this.audioLoopSubscription = this.connectCodeBlockEvent(
          this.props.engineSound,
          CodeBlockEvents.OnAudioCompleted,
          () => this.playLoopingSound(),
        );
      }
    }

    // Setup beep sound
    if (this.props.beepSound) {
      this.beepAudioGizmo = this.props.beepSound.as(AudioGizmo);
    }

    // Setup crash sound
    if (this.props.crashSound) {
      this.crashAudioGizmo = this.props.crashSound.as(AudioGizmo);
    }

    // Setup boost sound
    if (this.props.boostSound) {
      this.boostAudioGizmo = this.props.boostSound.as(AudioGizmo);
    }

    this.connectNetworkEvent(this.entity, CustomVehicleMessage, this.handleMessage);
    this.connectNetworkEvent(this.entity, VehiclePositionEvent, this.handlePositionUpdate);
    this.connectNetworkEvent(this.entity, VehicleProgressEvent, this.handleProgressUpdate);

    this.connectNetworkEvent(this.entity, RaceControlEvent, (data) => {
    if (this.props.debugMode) console.log('[RK_VehicleScript] Received race event', data);

      if (data.command === 'start') {
        this.raceStartTime = this.getCurrentTime(); // store in ms
        this.elapsedTime = 0;                    // reset elapsed time
        this.currentRaceActive = true;
        
        if ((this.sittingPlayerId) && (this.sittingPlayerId != 0))
        {
          this.sendNetworkEvent(this.entity, VehicleOccupantEvent, { 
            vehicleId: this.entity.id, 
            playerId: this.sittingPlayerId, 
          });
        }
      }

      if ((data.command === 'stop') || (data.command === 'finished')) {
        this.resetToHome();
        this.currentRaceActive = false;
        //this.raceStartTime = null;
      
        // Forward the race control event to the PrizeBar, so it can clear itself of any old items,
        // if STOP command is sent from the RaceControlEvent
        if (this.props.PrizeBarEntity)
        {
          this.sendNetworkEvent(
            this.props.PrizeBarEntity,
            RaceControlEvent,
            {
              command: data.command,
            }
          );
        }
      }
    });   

    this.connectNetworkEvent(this.entity, ResetEvent, (data) => this.onResetToCheckpoint(data));

    this.physicalEntity = this.entity.as(PhysicalEntity);

    // --- Initialize wheel entities ---
    this.frontLeftWheel = this.props.frontLeftWheel?.as(PhysicalEntity);
    this.frontRightWheel = this.props.frontRightWheel?.as(PhysicalEntity);
    this.rearLeftWheel = this.props.rearLeftWheel?.as(PhysicalEntity);
    this.rearRightWheel = this.props.rearRightWheel?.as(PhysicalEntity);
    this.steeringWheelEntity = this.props.steeringWheel?.as(PhysicalEntity);

    if (!this.initialPosition) {
      this.storeInitialState();
    }
  }

  private storeInitialState() {
    if (this.steeringWheelEntity) {
      // In preStart/start, store initial relative rotation
      const vehicleQuat = this.physicalEntity.rotation.get();
      const wheelQuat = this.steeringWheelEntity.rotation.get();
      this.steeringWheelData = {
        entity: this.steeringWheelEntity,
        initialRot: this.multiplyQuaternions(vehicleQuat.inverse(), wheelQuat), // relative to vehicle
        steerAxis: 'y'
      };
    }

    const storeLocalRotation = (wheel?: PhysicalEntity) => {
      if (!wheel) return;
      // base local rotation = inverse(vehicle rotation) * wheel world rotation
      const vehicleQuat = this.physicalEntity.rotation.get();
      const invVehicle = vehicleQuat.inverse();
      const localRot = this.multiplyQuaternions(invVehicle, wheel.rotation.get());
      this.wheelInitialRotations.set(wheel, localRot);
    };

    storeLocalRotation(this.frontLeftWheel);
    storeLocalRotation(this.frontRightWheel);
    storeLocalRotation(this.rearLeftWheel);
    storeLocalRotation(this.rearRightWheel);
    storeLocalRotation(this.steeringWheelEntity);

    this.initialPosition = this.physicalEntity.position.get();
    this.initialRotation = this.physicalEntity.rotation.get();
  }
  
  private getLeaderboardEntity(): Entity | null {
    if (!this.leaderboardEntities || this.leaderboardEntities.length === 0) {
        this.leaderboardEntities = this.world.findEntities("RK_WorldLeaderboard");
    }
    return this.leaderboardEntities.length > 0 ? this.leaderboardEntities[0] : null;
  }  
  
  private onResetToCheckpoint(data: { entityId: string; command: 'reset'; triggerPosition: Vec3; triggerRotation: Quaternion }) {
    this.isTeleporting = true;
    this.teleportTimer = 0; // reset timer

    const physEntity = this.entity.as(PhysicalEntity);
    if (!physEntity) return;

    // Stop motion
    this.velocity = Vec3.zero;
    this.angularVelocity = 0;

    // Move vehicle to checkpoint
    physEntity.position.set(data.triggerPosition);
    physEntity.rotation.set(data.triggerRotation);

    if (this.props.debugMode) {
        console.log(`[RK_VehicleReset] Vehicle ${this.entity.id} moved to reset position`);
    }
  }

  private handleMessage = async (data: { vehicleId: string; message: string }) => {
      // Ignore messages for other vehicles
      //if (data.vehicleId !== this.vehicleId) return;

      if (this.props.debugMode) console.log(`handleMessage: [${data.vehicleId}] : ${data.message}`);

      // Forward messages starting with "prize" to the PrizeBar
      if (data.message.startsWith("prize")) {
          if (this.props.PrizeBarEntity) {
              this.sendNetworkEvent(
                  this.props.PrizeBarEntity,
                  CustomVehicleMessage,
                  {
                      vehicleId: data.vehicleId,
                      message: data.message,
                  }
              );
              if (this.props.debugMode) console.log(`[ProtoVehicleScript] Forwarded prize message to PrizeBar`);
          } else {
              if (this.props.debugMode) console.warn('handleMessage: PrizeBarEntity is not assigned.');
          }
      }
  };
  
  private handlePositionUpdate = (data: { position: number }) => {
    //if (this.props.debugMode) {
      //console.log(`[Vehicle ${this.entity.id.toString()}] Position updated: ${data.position}`);  //very spammy
    //}

    // Only update if changed to reduce unnecessary UI updates
    if (this.currentPosition !== data.position) {
      this.currentPosition = data.position;

      if (this.props.RaceStatsEntity) {
        this.sendNetworkEvent(
          this.props.RaceStatsEntity,
          VehiclePositionEvent,
          {
            position: this.currentPosition,
          }
        );
      }
    }
  }; 

  private handleProgressUpdate  = (data: { lap: number; lapCount: number; raceActive: boolean, finished: boolean }) => {
    if (this.props.debugMode) {
      console.log(`[Vehicle ${this.entity.id.toString()}] progress sent to RPOverlay: lap: ${data.lap}, lapCount: ${data.lapCount}, raceActive: ${data.raceActive}`); 
    }
    
    // Only update if changed to reduce unnecessary UI updates
    this.currentLap = data.lap;
    this.currentLapCount = data.lapCount;
    this.currentRaceActive = data.raceActive;
    this.finished = data.finished;
    

    if (this.props.RaceStatsEntity) {
      this.sendNetworkEvent(
        this.props.RaceStatsEntity,
        VehicleProgressEvent,
        {
          lap: this.currentLap,
          lapCount: this.currentLapCount,
          raceActive: this.currentRaceActive,
          finished: this.finished,
        }
      );
    }

    if (this.currentRaceActive && this.raceStartTime !== null && !this.finished) {
      const now = this.getCurrentTime(); // ms
      this.elapsedTime = (now - this.raceStartTime) / 1000; // seconds
      if (this.props.debugMode) {
        console.log(`elapsed Time: ${this.elapsedTime} (now=${now}, start=${this.raceStartTime})`);
      }
    }
  
    if (!data.finished)
    {
        this.setLeaderboardForThisFinish = false;
    }
    
    if (data.finished && !this.setLeaderboardForThisFinish) {
        if (this.sittingPlayerId != null) {
          const updaterEntity = this.getLeaderboardEntity();
          if (updaterEntity) {
            this.sendNetworkEvent(
              updaterEntity,
              playerLBEvent,
            { playerId: this.sittingPlayerId, seconds: Math.round(this.elapsedTime) }
            );
          } else {
            console.warn("No leaderboard gizmo found in scene with gameObject name 'RK_WorldLeaderboard' + the RK_LeaderboardUpdater script on it");
          }
        } else {
            if (this.props.debugMode) console.warn("this.sittingPlayerId was null");
        }

        this.setLeaderboardForThisFinish = true;
        this.currentRaceActive = false;
        //this.raceStartTime = null;
        
        const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);
        gizmo?.player.set(null);
    }
  }; 
  
  private avatarScales: number[] = [0.1, 1, 5, 0.05];
  private avatarScaleIndex: number = 1;
  private tinySpeedFactor: number = 1.0;

  // Incremental avatar scaling function
  private setAvatarScale(index: number) {
    const player = this.entity.owner.get();
    if (player.id == 0) return;
    if ((this.sittingPlayerId == 0) || (this.sittingPlayerId == undefined)) return;
    
    if (!player || !player.avatarScale) return;

    try
    {
        // Clamp index to valid range
        this.avatarScaleIndex = Math.min(Math.max(0, index), this.avatarScales.length - 1);

        if (player.id != 0) {
            player.avatarScale.set(this.avatarScales[this.avatarScaleIndex]);
        }
    } catch {}
  }

  private changeAvatarScale(increment: number) {
    this.setAvatarScale(this.avatarScaleIndex + increment);
  }

  private cycleCameraMode() { 
    this.currentCameraIndex =
      (this.currentCameraIndex + 1) % this.cameraModes.length;

    const mode = this.cameraModes[this.currentCameraIndex];
    const targetEntity = this.entity;

    const options: CameraTransitionOptions = {
      duration: 0.01,
      easing: Easing.EaseInOut,
    };

    if (this.props.debugMode == true) console.log("Cam mode: " + mode);

    switch (mode) {
      case 'thirdperson':
        LocalCamera.resetCameraFOV(options);
        LocalCamera.setCameraModeThirdPerson(options);
        break;        
      case 'firstperson':
        LocalCamera.resetCameraFOV(options);
        LocalCamera.setCameraModeFirstPerson(options);
        break;
      case 'attach1':
        LocalCamera.resetCameraFOV(options);
        LocalCamera.setCameraModeAttach(this.entity, {
            positionOffset: this.props.camAttachPositionOffset1,
            rotationSpeed: this.props.camRotationSpeed,
            duration: this.props.easeSpeed,
            easing: Easing.EaseInOut,
        });
        break;
      case 'attach2':
        LocalCamera.resetCameraFOV(options);
        LocalCamera.setCameraModeAttach(this.entity, {
            positionOffset: this.props.camAttachPositionOffset2,
            rotationSpeed: this.props.camRotationSpeed,
            duration: this.props.easeSpeed,
            easing: Easing.EaseInOut,
        });
        break;
      case 'attach3':
        LocalCamera.resetCameraFOV(options);
        LocalCamera.setCameraModeAttach(this.entity, {
            positionOffset: this.props.camAttachPositionOffset3,
            rotationSpeed: this.props.camRotationSpeed,
            duration: this.props.easeSpeed,
            easing: Easing.EaseInOut,
        });
        break;
      case 'orbit':
        LocalCamera.resetCameraFOV(options);
        LocalCamera.setCameraModeOrbit({
          distance: this.props.camOrbitDistance,
          verticalOffset: this.props.camOrbitVerticalOffset,
          translationSpeed: this.props.camOrbitTranslationSpeed,
          rotationSpeed: this.props.camOrbitRotationSpeed,          
          ...options,
        });
        break;
    }
  }

  override start() {
    this.connectLocalBroadcastEvent(World.onUpdate, (data: { deltaTime: number }) => {
      this.moveObject(data);
      
      if (this.isTeleporting) {
        this.teleportTimer += data.deltaTime;

        if (this.teleportTimer >= 2.0) {
            this.isTeleporting = false;
            this.teleportTimer = 0;

            if (this.props.debugMode) {
                console.log(`[RK_VehicleReset] Teleport complete for vehicle ${this.entity.id}`);
            }
        }
      }
      
      if (this.currentRaceActive && this.raceStartTime !== null && !this.finished) {
        const now = this.getCurrentTime(); // ms
        this.elapsedTime = (now - this.raceStartTime) / 1000; // seconds
        //if (this.props.debugMode) console.log(`elapsed Time: ${this.elapsedTime} (now=${now}, start=${this.raceStartTime})`);
      }          
    });

    // Used for detecting hits from projectiles
    if (this.props.HitBoxTrigger)
    {
      this.connectCodeBlockEvent(
        this.props.HitBoxTrigger,
        CodeBlockEvents.OnEntityEnterTrigger,
        (enteredBy: hz.Entity) => this.onTriggerEnter(enteredBy)
      );
    }
    
    // Used for detecting vehicle to vehicle collision
    this.connectCodeBlockEvent(
      this.entity,
      CodeBlockEvents.OnEntityCollision,
      this.onCollision.bind(this)
    );

  }

  private onTriggerEnter(Entity: hz.Entity) {
    if (Entity.tags.contains("bolt"))
    {
        if (this.props.debugMode) console.log("Hit by lightning bolt");

        // Scale the vehicle
        this.entity.scale.set(new Vec3(0.1, 0.1, 0.1));

        // Scale the avatar
        this.setAvatarScale(0); // sets avatar to small
        this.tinySpeedFactor = 0.1;

        // Reset both after 10 seconds
        this.async.setTimeout(() => {
            this.entity.scale.set(new Vec3(1, 1, 1));
            this.setAvatarScale(1); // reset avatar to normal
            this.tinySpeedFactor = 1.0;
        }, 10 * 1000);
    }
    else if (Entity.tags.contains("banana"))
    {
        if (this.props.debugMode) console.log("Hit by banana");

        this.spinningOutEnabled = true;
        if (this.props.debugMode) console.log("Flustered mode enabled");
        
        // Stop the forced spin on vehicle after a few seconds
        this.async.setTimeout(() => {
            this.spinningOutEnabled = false;
            if (this.props.debugMode) console.log("Flustered mode disabled");
        }, this.props.flusteredRotationTime * 1000);
    }
    else if (Entity.tags.contains("flatten"))
    {
        if (this.props.debugMode) console.log("Hit by banana");

        this.flattenEnabled = true;
        this.entity.scale.set(new Vec3(1,0.05,1));
        this.setAvatarScale(3);
        
        if (this.props.debugMode) console.log("Flattened mode enabled");
        
        // Stop the forced spin on vehicle after a few seconds
        this.async.setTimeout(() => {
            this.flattenEnabled = false;
            this.entity.scale.set(new Vec3(1,1,1));
            this.setAvatarScale(1);
            if (this.props.debugMode) console.log("Flattened mode disabled");
        }, this.props.flattenedTime * 1000);        
    }
    else if (Entity.tags.contains("dart"))
    {
        this.launchingUpEnabled  = true;
        if (this.props.debugMode) console.log("Launch mode enabled");
        
        // Stop the forced spin on vehicle after a few seconds
        this.async.setTimeout(() => {
            this.launchingUpEnabled  = false;
            if (this.props.debugMode) console.log("Launch mode disabled");
        }, this.props.launchTime * 1000);
    }
  }
  
  private onCollision(collidedWith: Entity) {
    if (collidedWith.tags.contains("booster"))
    {
        this.boostTotal = this.boostTotal + this.props.boostSpeedIncrease;
        
        // Remove the boost after X seconds
        this.async.setTimeout(() => {
            this.boostTotal = this.boostTotal - this.props.boostSpeedIncrease;
        }, this.props.boostTime * 1000);
    }

    if (collidedWith.tags.contains("vehicle"))
    {
      if (collidedWith.tags.contains("booster"))
      {
        this.boostAudioGizmo?.play();
        const boostParticleGizmo = this.props.boostParticleFx?.as(ParticleGizmo);
        boostParticleGizmo?.play();
      }
      else
      {
        this.crashAudioGizmo?.play();
        const hitParticleGizmo = this.props.hitSparkParticleFx?.as(ParticleGizmo);
        hitParticleGizmo?.play();
      }
    }
  }  
 
  private moveObject(data: { deltaTime: number }) {
    if (this.isTeleporting) return;
    if (this.currentRaceActive && this.raceStartTime !== null) {
      const now = this.getCurrentTime(); // ms
      this.elapsedTime = (now - this.raceStartTime) / 1000; // seconds
    }

    this.updateGrounded();
    if (!this.isGrounded || !this.physicalEntity) return;
    if (!this.currentRaceActive) return;
    if (this.finished) return;
    if (this.flattenEnabled) return;    
    
    if (this.updateAxesFromJoystick) this.updateAxesFromJoystick();
    const deltaTime = data.deltaTime;
    const leftX = this.axisX;
    const leftY = this.axisY;

    if (Math.abs(leftY) > 0) {
        const forward = this.physicalEntity.forward.get();
        this.velocity = this.velocity.add(forward.mul((this.props.speed! * this.tinySpeedFactor) * leftY * deltaTime * this.props.maxFriction));
        
        // Add total extra speed from boosters (if any)
        if (this.boostTotal > 0) 
        {
            this.velocity = this.velocity.add(forward.mul((this.boostTotal) * leftY * deltaTime * this.props.maxFriction));
        }
        
    } else {
        const forward = this.physicalEntity.forward.get();
        this.velocity = this.velocity.mul(this.props.minFriction); // Friction
    }

    // Lateral grip (reduce sliding)
    if (this.velocity.magnitude() > this.props.lateralGripCutoff) {
        const forward = this.physicalEntity.forward.get();
        const right = this.physicalEntity.right.get();
        const forwardSpeed = this.velocity.dot(forward);
        const lateralSpeed = this.velocity.dot(right);
        this.velocity = this.velocity.sub(right.mul(lateralSpeed * (1 - this.props.lateralGrip)));
    }

    // --- Angular velocity (turning) ---
    if (Math.abs(leftX) > 0.05) {
        // Flip steering when moving backwards
        const directionSign = leftY >= 0 ? 1 : -1; 
        const isMobile = this.world.getLocalPlayer().deviceType.get() === PlayerDeviceType.Mobile;
        const turnSpeed = isMobile ? this.props.mobileTurnSpeed! : this.props.turnspeed!;
        this.angularVelocity += leftX * directionSign * turnSpeed * deltaTime * 6;
    }

    this.angularVelocity *= 0.95; // decay
    this.angularVelocity = Math.max(this.props.minAngularVelocity!, Math.min(this.props.maxAngularVelocity!, this.angularVelocity));

    if (Math.abs(this.angularVelocity) > 0.01) {
        const rot = Quaternion.fromAxisAngle(this.physicalEntity.up.get(), this.angularVelocity * deltaTime);
        this.physicalEntity.rotation.set(this.physicalEntity.rotation.get().mul(rot));
    }

    // --- Predict next position ---
    const nextPos = this.physicalEntity.position.get().add(this.velocity.mul(deltaTime));

    // --- Collision check with raycast ---
    let canMove = true;
    if (this.raycastGizmo) {
        const moveDir = nextPos.sub(this.physicalEntity.position.get()).normalize();
        const hit = this.raycastGizmo.raycast(
            this.physicalEntity.position.get(),
            moveDir,
            { maxDistance: this.velocity.magnitude() * deltaTime + 0.5 } // add buffer
        );
        if (hit) {
            canMove = false;
            this.velocity = Vec3.zero; // stop on collision
        }
    }

    // --- Apply movement if clear ---
    if (canMove && this.velocity.magnitude() > 0.0001) {
        this.physicalEntity.position.set(nextPos);
    }

    // Clamp velocity
    if (this.velocity.magnitude() > this.props.maxVelocity) {
        this.velocity = this.velocity.normalize().mul(this.props.maxVelocity);
    }

    // --- Engine sound & FX ---
    if (this.audioGizmo) {
        const speed = this.velocity.magnitude();
        const pitch = 0.25 + (speed * this.props.pitchFactor);
        this.audioGizmo.pitch.set(pitch);

        const particleGizmo1 = this.props.smokeParticleFx1?.as(ParticleGizmo);
        const particleGizmo2 = this.props.smokeParticleFx2?.as(ParticleGizmo);
        const trailGizmo1 = this.props.trailFx1?.as(TrailGizmo);
        const trailGizmo2 = this.props.trailFx2?.as(TrailGizmo);
        const boostTrailGizmo1 = this.props.boostTrailFx?.as(TrailGizmo);

        const now = Date.now() / 1000;
        if (speed > this.props.smokeThreshold && now - this.lastParticleTime >= this.particleCooldown) {
            particleGizmo1?.play(); particleGizmo2?.play(); this.lastParticleTime = now;
        } else if (speed <= this.props.smokeThreshold && now - this.lastParticleTime >= this.particleCooldown) {
            particleGizmo1?.stop(); particleGizmo2?.stop(); this.lastParticleTime = now;
        }
        if (speed > this.props.trailsThreshold && now - this.lastTrailTime >= this.trailCooldown) {
            trailGizmo1?.play(); trailGizmo2?.play(); this.lastTrailTime = now;
        } else if (speed <= this.props.trailsThreshold && now - this.lastTrailTime >= this.trailCooldown) {
            trailGizmo1?.stop(); trailGizmo2?.stop(); this.lastTrailTime = now;
        }
        
        if (this.boostTotal > 0)
        {        
            boostTrailGizmo1?.play();
        }
        else
        {
            boostTrailGizmo1?.stop(); 
        }
    }

    // Effect when we hit a item with tag banana
    if (this.spinningOutEnabled === true) {
        // how much to spin this frame (degrees per second ? radians per frame)
        const deltaSpin = this.degreesToRadians(this.props.flusteredRotationSpeed! * data.deltaTime);

        // create a quaternion that represents that little bit of spin
        const spinQuat = Quaternion.fromAxisAngle(Vec3.up, deltaSpin);

        // apply it on top of the current rotation
        const currentRot = this.entity.rotation.get();
        const newRot = currentRot.mul(spinQuat); // << order matters
        this.entity.rotation.set(newRot);
    }

    // Effect when we get launched upward
    if (this.launchingUpEnabled === true) {
        // Move straight up each frame
        const pos = this.entity.position.get();
        pos.y += this.props.launchSpeed! * data.deltaTime; // launchSpeed is units/sec
        this.entity.position.set(pos);
    }

    // --- Animate wheels ---
    this.updateWheelRotation(deltaTime);
  }
  
  private degreesToRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
  
  private multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
      const w = a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z;
      const x = a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y;
      const y = a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x;
      const z = a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w;
      return new Quaternion(x, y, z, w);
  }
  
  private wheelRotationAmount: number = 0; // Accumulate rotation

  private updateWheelRotation(deltaTime: number) {
     if (!this.currentRaceActive) return;
     if (this.finished) return;
      if (!this.physicalEntity) return;

      const velocity = this.velocity;
      const moveSpeed = velocity.dot(this.physicalEntity.forward.get());
      const turnAngleRad = this.axisX * 30 * Math.PI / 180;
      const spinAmount = moveSpeed * deltaTime * (this.props.wheelSpinSpeed ?? 5);  //Rotation for the Wheels

      this.wheelRotationAmount += spinAmount; // Accumulate the rotation
      const vehicleQuat = this.physicalEntity.rotation.get();

      const applyWheel = (wheel?: PhysicalEntity, spin: boolean = true, steer: boolean = false) => {
          if (!wheel) return;

          const localBase = this.wheelInitialRotations.get(wheel) ?? wheel.rotation.get();
          const euler = localBase.toEuler();

          if (spin) euler.x += this.wheelRotationAmount; // Use accumulated rotation!
          if (steer) euler.y = turnAngleRad; // Steering

          const worldQuat = this.multiplyQuaternions(vehicleQuat, this.eulerToQuaternion(euler));
          wheel.rotation.set(worldQuat);
      };
      
      applyWheel(this.frontLeftWheel, true, true);
      applyWheel(this.frontRightWheel, true, true);
      applyWheel(this.rearLeftWheel, true, false);
      applyWheel(this.rearRightWheel, true, false);

      // --- Steering wheel ---
      if (this.steeringWheelData) {
          const { entity, initialRot, steerAxis } = this.steeringWheelData;

          // Create a quaternion for the steering rotation along the chosen axis
          let steerQuat: Quaternion;
          const angle = turnAngleRad;

          switch (steerAxis) {
              case 'x':
                  steerQuat = new Quaternion(Math.sin(angle / 2), 0, 0, Math.cos(angle / 2));
                  break;
              case 'y':
                  steerQuat = new Quaternion(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
                  break;
              case 'z':
                  steerQuat = new Quaternion(0, 0, Math.sin(angle / 2), Math.cos(angle / 2));
                  break;
              default:
                  steerQuat = new Quaternion(0, Math.sin(angle / 2), 0, Math.cos(angle / 2));
          }

          // final world rotation = vehicle rotation * initial wheel offset * steering rotation
          const finalQuat = this.multiplyQuaternions(vehicleQuat, this.multiplyQuaternions(initialRot, steerQuat));
          entity.rotation.set(finalQuat);
      }
  }
  
  private onPlayerEnter(toPlayer: Player) {
    if (this.props.debugMode) console.log('VEH Script - onPlayerEnter() - Local player now owns vehicle, binding input');
    this.sittingPlayerId = toPlayer.id;
  
    this.axisX = 0;
    this.axisY = 0;

    this.updateAvatarOffset();

    // Make sure this player owns the entity
    this.entity.owner.set(toPlayer);
    if (this.props.PrizeBarEntity) this.props.PrizeBarEntity.owner.set(toPlayer);
    if (this.props.RaceStatsEntity) this.props.RaceStatsEntity.owner.set(toPlayer);

    // Always bind inputs for the local player
    if (toPlayer.id === this.world.getLocalPlayer().id) {
      this.bindLocalInput();
    }

    this.playLoopingSound();  
    this.updateAvatarOffset();    
    
    toPlayer.setAvatarGripPoseOverride(this.props.gripPoseDriving! as unknown as AvatarGripPose);
    
    this.sendNetworkEvent(this.entity, VehicleOccupantEvent, { 
      vehicleId: this.entity.id, 
      playerId: toPlayer.id 
    });  
  }

  private onPlayerExit(player: Player) {
    if (this.props.debugMode) console.log(`Player ${player.name.get()} got up`);

    if (player.id === this.sittingPlayerId) 
    {
        player.avatarScale.set(this.avatarScales[1]);
    }

    if (player.id === this.sittingPlayerId) {
      this.disconnectInput();
      this.sittingPlayerId = undefined;
      
        const options: CameraTransitionOptions = {
            duration: 0.5,
            easing: Easing.EaseInOut,
        };
        LocalCamera.setCameraModeThirdPerson(options);      
        LocalCamera.resetCameraFOV(options);
    }

    this.audioGizmo?.stop();
    this.revertAvatarOffset();
    
    player.clearAvatarGripPoseOverride();
    
    if (this.finished == false)
    {
      this.sendNetworkEvent(this.entity, VehicleOccupantEvent, { 
        vehicleId: this.entity.id, 
        playerId: 0
      });
    }
    
    if (this.props.exitTransform) player.position.set(new Vec3(this.props.exitTransform.position.get().x, this.props.exitTransform.position.get().y + 5, this.props.exitTransform.position.get().z));
  }

  private updateAvatarOffset() {
      const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);
      if (!gizmo || !this.physicalEntity || !this.props.sittingTransform) return;
      gizmo.moveRelativeTo(
          this.props.sittingTransform,
          new Vec3(0,0,0),1
      );
  }

  private revertAvatarOffset() {
      const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);
      if (!gizmo || !this.physicalEntity || !this.props.exitTransform) return;
      gizmo.moveRelativeTo(
          this.props.exitTransform,
          new Vec3(0,0,0),1
      );
  }

  private prevRaceActive: boolean = false;
  
  receiveOwnership(state: VehicleState, fromPlayer: Player, toPlayer: Player): void {
    this.elapsedTime = state.elapsedTime;
    this.currentRaceActive = state.currentRaceActive;
    this.raceStartTime = state.raceStartTime;
    this.prevRaceActive = state.prevRaceActive;
    this.sittingPlayerId = toPlayer.id;

    // Restore initial states
    if (state.initialPosition) {
      this.initialPosition = new Vec3(state.initialPosition.x, state.initialPosition.y, state.initialPosition.z);
    }
    if (state.initialRotation) {
      this.initialRotation = new Quaternion(state.initialRotation.x, state.initialRotation.y, state.initialRotation.z, state.initialRotation.w);
    }
    if (state.wheelInitialRotations) {
      this.wheelInitialRotations.clear();
      [this.frontLeftWheel, this.frontRightWheel, this.rearLeftWheel, this.rearRightWheel, this.steeringWheelEntity].forEach(wheel => {
        if (wheel) {
          const id = wheel.id.toString();
          if (state.wheelInitialRotations![id]) {
            const rot = state.wheelInitialRotations![id];
            this.wheelInitialRotations.set(wheel, new Quaternion(rot.x, rot.y, rot.z, rot.w));
          }
        }
      });
    }
    if (state.steeringInitialRot) {
      const rot = state.steeringInitialRot;
      if (this.steeringWheelData) {
        this.steeringWheelData.initialRot = new Quaternion(rot.x, rot.y, rot.z, rot.w);
      }
    }

    if (toPlayer.id === this.world.getLocalPlayer().id) {
      if (this.props.debugMode) console.log('Veh Script - ReceiveOwnership() - Local player now owns vehicle, binding input');

      this.updateAvatarOffset();

      // Make sure this player owns the entity
      if (this.props.PrizeBarEntity) this.props.PrizeBarEntity.owner.set(toPlayer);
      if (this.props.RaceStatsEntity) this.props.RaceStatsEntity.owner.set(toPlayer);

      // Always bind inputs for the local player
      if (toPlayer.id === this.world.getLocalPlayer().id) {
        this.bindLocalInput();
      }

      this.playLoopingSound();  
      this.updateAvatarOffset();    
    
      toPlayer.setAvatarGripPoseOverride(this.props.gripPoseDriving! as unknown as AvatarGripPose);
    
      
      this.sendNetworkEvent(this.entity, VehicleOccupantEvent, { 
        vehicleId: this.entity.id, 
        playerId: toPlayer.id 
      });
    
      this.onPlayerEnter(toPlayer);
    }
    
    try
    {
    if (this.props.debugMode) console.log("VEHScript - Received ownership: " + state.elapsedTime + "," + state.currentRaceActive + "," + state.raceStartTime + "," + state.prevRaceActive + ", fromPlayer: " + fromPlayer.id + ", toPlayer: " + toPlayer.id);
    } catch {}    
  }

  transferOwnership(fromPlayer: Player, toPlayer: Player): VehicleState {
    //console.log("VEHScript - Ownership transferred: " + this.elapsedTime + "," + this.currentRaceActive + "," + this.raceStartTime + "," + this.prevRaceActive + " fromPlayer: " + fromPlayer.name.get() + ", toPlayer: " + toPlayer.name.get());

    if (this.props.PrizeBarEntity) this.props.PrizeBarEntity.owner.set(toPlayer);
    if (this.props.RaceStatsEntity) this.props.RaceStatsEntity.owner.set(toPlayer);

    // Serialize initial states
    const wheelInitialRotations: Record<string, {x: number, y: number, z: number, w: number}> = {};
    this.wheelInitialRotations.forEach((rot, entity) => {
      wheelInitialRotations[entity.id.toString()] = {x: rot.x, y: rot.y, z: rot.z, w: rot.w};
    });

    const state: VehicleState = {
      elapsedTime: this.elapsedTime,
      currentRaceActive: this.currentRaceActive,
      raceStartTime: this.raceStartTime,
      prevRaceActive: this.prevRaceActive,
      initialPosition: {x: this.initialPosition.x, y: this.initialPosition.y, z: this.initialPosition.z},
      initialRotation: {x: this.initialRotation.x, y: this.initialRotation.y, z: this.initialRotation.z, w: this.initialRotation.w},
      wheelInitialRotations,
    };
    if (this.steeringWheelData) {
      const rot = this.steeringWheelData.initialRot;
      state.steeringInitialRot = {x: rot.x, y: rot.y, z: rot.z, w: rot.w};
    }

    return state;
  }

  private bindLocalInput() {
    this.disconnectInput();
    const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);
    const buttonOptions = { preferredButtonPlacement: ButtonPlacement.Center };

    // Eject button
    this.jumpInput = PlayerControls.connectLocalInput(
      PlayerInputAction.RightPrimary,
      ButtonIcon.Door,
      this,
      buttonOptions
    );

    this.jumpInput.registerCallback((action, pressed) => {
      if (pressed && gizmo && gizmo.player.get()?.id === this.world.getLocalPlayer().id) {
        gizmo.player.set(null);
        this.disconnectInput();
      }
    });

    // --- Beep button ---
    this.beepInput = PlayerControls.connectLocalInput(
        PlayerInputAction.RightSecondary,
        ButtonIcon.Punch,
        this,
        buttonOptions
    );

    this.beepInput.registerCallback((action, pressed) => {
        if (pressed && this.beepAudioGizmo && gizmo?.player.get()?.id === this.world.getLocalPlayer().id) {
            this.beepAudioGizmo.play();
        }
    });

    // Joystick input
    const owner = this.entity.owner.get();
    if (owner && owner.id === this.world.getLocalPlayer().id) {
      const isMobile = this.world.getLocalPlayer().deviceType.get() === PlayerDeviceType.Mobile;
      this.leftXAxisInput = PlayerControls.connectLocalInput(PlayerInputAction.LeftXAxis, ButtonIcon.None, this);
      this.leftYAxisInput = PlayerControls.connectLocalInput(PlayerInputAction.LeftYAxis, ButtonIcon.None, this);

      const deadzone = isMobile ? 0.05 : 0.05;
      this.updateAxesFromJoystick = () => {
        if (!this.leftXAxisInput || !this.leftYAxisInput) return;
        this.axisX = this.leftXAxisInput.axisValue.get() ?? 0;
        this.axisY = this.leftYAxisInput.axisValue.get() ?? 0;
        if (Math.abs(this.axisX) < deadzone) this.axisX = 0;
        if (Math.abs(this.axisY) < deadzone) this.axisY = 0;
      };
    }

   // --- Camera toggle button --- 
    this.cameraInput = PlayerControls.connectLocalInput(
      PlayerInputAction.LeftSecondary, // pick a free input action
      ButtonIcon.EagleEye,             // valid button icon
      this,
      { preferredButtonPlacement: ButtonPlacement.Center },
    );

    this.cameraInput.registerCallback(
      (action: PlayerInputAction, pressed: boolean) => {
        const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);

        if (
          pressed &&
          gizmo?.player.get()?.id === this.world.getLocalPlayer().id
        ) {
          this.cycleCameraMode();
        }
      },
    );
  }
  
  private connectLeftJoystickInput() {
      const inputX = PlayerInputAction.LeftXAxis;
      const inputY = PlayerInputAction.LeftYAxis;

      if (!PlayerControls.isInputActionSupported(inputX) || !PlayerControls.isInputActionSupported(inputY)) {
          if (this.props.debugMode) console.log("Left joystick input is not supported on this device.");
          return;
      }

      this.leftXAxisInput = PlayerControls.connectLocalInput(inputX, ButtonIcon.None, this);
      this.leftYAxisInput = PlayerControls.connectLocalInput(inputY, ButtonIcon.None, this);

      // --- Register callbacks ---
      this.leftXAxisInput.registerCallback(() => {
          this.axisX = this.leftXAxisInput?.axisValue.get() ?? 0;
      });

      this.leftYAxisInput.registerCallback(() => {
          this.axisY = this.leftYAxisInput?.axisValue.get() ?? 0;
      });
  }

  private updateAxesFromJoystick() {
      if (!this.leftXAxisInput || !this.leftYAxisInput) return;

      const localPlayer = this.world.getLocalPlayer();
      if (!localPlayer || localPlayer.id !== this.entity.owner.get()?.id) return;

      this.axisX = this.leftXAxisInput.axisValue.get() ?? 0;
      this.axisY = this.leftYAxisInput.axisValue.get() ?? 0;

      // Optional deadzone
      const deadzone = 0.05; // fixed small deadzone
      if (Math.abs(this.axisX) < deadzone) this.axisX = 0;
      if (Math.abs(this.axisY) < deadzone) this.axisY = 0;
  }

  private logInputValues() {
    if (this.props.debugMode)
      console.log(
        `Left X Axis (turn): ${this.axisX.toFixed(2)}, Left Y Axis (forward/back): ${this.axisY.toFixed(2)}`,
      );
  }

  private lastGrounded: boolean = true; // store previous frame state
  private lastCrashTime: number = 0; // timestamp of last crash sound
  private crashCooldown: number = 2.0; // seconds

  private updateGrounded() {
    if (!this.raycastGizmo || !this.physicalEntity) return;

    const origin = this.physicalEntity.position.get();
    const hit = this.raycastGizmo.raycast(origin, this.props.rcDown, {
      maxDistance: this.props.groundCheckDistance,
    });

    let currentlyGrounded = false;

    if (hit != null) {
      switch (hit.targetType) {
        case RaycastTargetType.Entity: {
          const entityHit = hit as EntityRaycastHit;
          // Only grounded if the entity has the "ground" tag
          currentlyGrounded = entityHit.target.tags?.get()?.includes("ground") ?? false;
          break;
        }
      }
    }

    const now = Date.now() / 1000;

    if (!this.lastGrounded && currentlyGrounded && this.crashAudioGizmo) {
      if (now - this.lastCrashTime >= this.crashCooldown) {
        this.crashAudioGizmo.play();

        const hitParticleGizmo = this.props.hitSparkParticleFx?.as(ParticleGizmo);
        hitParticleGizmo?.play();

        this.lastCrashTime = now;
      }
    }

    this.isGrounded = currentlyGrounded;
    this.lastGrounded = currentlyGrounded;

    if (this.props.debugMode) {
      const hitInfo =
      hit?.targetType === RaycastTargetType.Entity
        ? (hit as EntityRaycastHit).target.name
        : hit?.targetType === RaycastTargetType.Static
        ? "static geometry"
        : "no hit";
      //console.log(`[GroundCheck] Grounded: ${this.isGrounded}, Hit: ${hitInfo}`); // the spammiest of all 
    }
  }


  private velocity: Vec3 = Vec3.zero;
  private angularVelocity: number = 0;

  private eulerToQuaternion(euler: Vec3): Quaternion {
      const cx = Math.cos(euler.x / 2);
      const sx = Math.sin(euler.x / 2);
      const cy = Math.cos(euler.y / 2);
      const sy = Math.sin(euler.y / 2);
      const cz = Math.cos(euler.z / 2);
      const sz = Math.sin(euler.z / 2);

      const w = cx * cy * cz + sx * sy * sz;
      const x = sx * cy * cz - cx * sy * sz;
      const y = cx * sy * cz + sx * cy * sz;
      const z = cx * cy * sz - sx * sy * cz;

      return new Quaternion(x, y, z, w);
  }

  private playLoopingSound() {
    if (this.sittingPlayerId && this.audioGizmo) {
      this.audioGizmo.play();
    }
  }

  private disconnectInput() {
    if (this.jumpInput) {
      this.jumpInput.disconnect();
      this.jumpInput = undefined;
    }

    if (this.beepInput) {
      this.beepInput.disconnect();
      this.beepInput = undefined;
    }

    if (this.leftXAxisInput) {
      this.leftXAxisInput.disconnect();
      this.leftXAxisInput = undefined;
    }
    if (this.leftYAxisInput) {
      this.leftYAxisInput.disconnect();
      this.leftYAxisInput = undefined;
    }
    this.axisX = 0;
    this.axisY = 0;
    
    if (this.cameraInput) { this.cameraInput.disconnect(); this.cameraInput = undefined; }    
  }
  
  private resetToHome() {
    if (!this.physicalEntity) return;
    this.velocity = Vec3.zero;           // stop motion
    this.angularVelocity = 0;            // stop spinning
    this.physicalEntity.position.set(this.initialPosition);
    this.physicalEntity.rotation.set(this.initialRotation);

    // Reset wheels to initial rotations
    this.wheelInitialRotations.forEach((initialRot, wheel) => {
      const vehicleQuat = this.physicalEntity.rotation.get();
      const worldQuat = this.multiplyQuaternions(vehicleQuat, initialRot);
      wheel.rotation.set(worldQuat);
    });

    if (this.props.debugMode) console.log(`[Vehicle ${this.entity.id}] Reset to home position/rotation`);
  }
  
  override dispose() {
     this.disconnectInput();
     this.audioLoopSubscription?.disconnect();
   }
}

Component.register(RK_VehicleScript_1a);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// RaceEntryButton script, talks to RK_RaceManager
/////////////////////////////////////////////////////////////////////////////////////////

// Network event for joining
const RaceJoinEvent = new hz.NetworkEvent<{ playerIndex: number }>('RaceJoinEvent');

class RK_RaceEntryButton extends hz.Component<typeof RK_RaceEntryButton> {
  static executionMode = 'local';

  static propsDefinition = {
    debugMode: { type: hz.PropTypes.Boolean, default: true },
    button: { type: hz.PropTypes.Entity },
    raceManagerEntity: { type: hz.PropTypes.Entity },
  };

  override start() {
    const btn = this.props.button;
    if (!btn) return;

    if (this.props.debugMode) console.log(`[RK_RaceEntryButton] Connected button ${btn.id}`);

    this.connectCodeBlockEvent(
      btn,
      hz.CodeBlockEvents.OnPlayerEnterTrigger,
      (player: Player) => this.onButtonPressed(player)
    );
  }

  private onButtonPressed(player: Player) {
    const playerIndex = player.index.get();
    if (this.props.debugMode) console.log(`[RK_RaceEntryButton] Player ${player.id} pressed button`);

    // Send join request to server using player index
    this.sendNetworkEvent(this.props.raceManagerEntity!, RaceJoinEvent, { playerIndex });
  }
}

hz.Component.register(RK_RaceEntryButton);


/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// RK_SpectatorCamera (safe, working version)
/////////////////////////////////////////////////////////////////////////////////////////

class RK_SpectatorCamera extends hz.Component<typeof RK_SpectatorCamera> {
  static executionMode = 'local';

  static propsDefinition = {
    debugMode: { type: hz.PropTypes.Boolean, default: false },
    targetEntity: { type: hz.PropTypes.Entity },
    startButtonTrigger: { type: hz.PropTypes.Entity },
    positionOffset: { type: hz.PropTypes.Vec3, default: new hz.Vec3(0, 1.5, -7.0) },
    camRotationSpeed: { type: hz.PropTypes.Number, default: 2 },
    easeSpeed: { type: hz.PropTypes.Number, default: 0.5 },
  };

  private exitCamInput?: PlayerInput;

  start(): void {
    if (this.props.debugMode) console.log("[RK_SpectatorCamera] start() called");

    if (this.props.startButtonTrigger) {
      this.connectCodeBlockEvent(
        this.props.startButtonTrigger,
        hz.CodeBlockEvents.OnPlayerEnterTrigger,
        (player: Player) => this.onTriggerEnter(player)
      );
      if (this.props.debugMode) console.log("[RK_SpectatorCamera] Start trigger connected");
    }
  }

  private onTriggerEnter(player: Player) {
    const localPlayer = this.world.getLocalPlayer();

    if (this.props.debugMode) {
      console.log(`[RK_SpectatorCamera] Trigger fired by ${player.name?.get() ?? 'Unknown'}`);
    }

    // Always try to attach camera if local player clicked
    if (player.id === localPlayer.id) {
      if (this.props.debugMode) console.log("[RK_SpectatorCamera] Local player clicked trigger, startFollowing");
      this.startFollowing();
    }

    // Request ownership transfer anyway (safe even if you already own it)
    this.entity.owner.set(player);
  }

  // Handles first-time ownership
  receiveOwnership(state: any, fromPlayer: Player, toPlayer: Player) {
    const localPlayer = this.world.getLocalPlayer();

    if (toPlayer.id === localPlayer.id) {
      if (this.props.debugMode) console.log("[RK_SpectatorCamera] Gained ownership via receiveOwnership");
      this.startFollowing();
    } else if (fromPlayer?.id === localPlayer.id) {
      if (this.props.debugMode) console.log("[RK_SpectatorCamera] Lost ownership via receiveOwnership");
      this.stopFollowing();
    }
  }

  // Handles explicit ownership transfers
  transferOwnership(fromPlayer: Player, toPlayer: Player) {
    const localPlayer = this.world.getLocalPlayer();

    if (this.props.debugMode) {
      console.log(`Ownership transferred from ${fromPlayer?.name?.get() ?? "Unknown"} to ${toPlayer?.name?.get() ?? "Unknown"}`);
    }

    if (toPlayer.id === localPlayer.id) {
      this.startFollowing();
    } else if (fromPlayer?.id === localPlayer.id) {
      this.stopFollowing();
    }

    return {};
  }

  private startFollowing() {
    if (!this.props.targetEntity) {
      if (this.props.debugMode) console.log("[RK_SpectatorCamera] No target entity slotted!");
      return;
    }

    if (this.props.debugMode) console.log("[RK_SpectatorCamera] startFollowing() called");

    LocalCamera.setCameraModeAttach(this.props.targetEntity, {
      positionOffset: this.props.positionOffset,
      rotationSpeed: this.props.camRotationSpeed,
      duration: this.props.easeSpeed,
      easing: Easing.EaseInOut,
    });

    this.bindLocalInput();
  }

  stopFollowing() {
    if (this.props.debugMode) console.log("[RK_SpectatorCamera] stopFollowing() called");

    LocalCamera.setCameraModeThirdPerson({
      duration: this.props.easeSpeed,
      easing: Easing.EaseInOut,
    });

    this.disconnectInput();
  }

  private bindLocalInput() {
    this.disconnectInput();

    if (this.props.debugMode) console.log("[RK_SpectatorCamera] Binding local input");

    this.exitCamInput = PlayerControls.connectLocalInput(
      PlayerInputAction.RightPrimary,
      ButtonIcon.Door,
      this,
      { preferredButtonPlacement: ButtonPlacement.Center }
    );

    this.exitCamInput.registerCallback((action, pressed) => {
      if (pressed) this.stopFollowing();
    });
  }

  private disconnectInput() {
    if (this.exitCamInput) {
      if (this.props.debugMode) console.log("[RK_SpectatorCamera] Disconnecting local input");
      this.exitCamInput.disconnect();
      this.exitCamInput = undefined;
    }
  }
}

hz.Component.register(RK_SpectatorCamera);

/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons 
// UI 'prizebar' script
/////////////////////////////////////////////////////////////////////////////////////////

export class RK_PrizeBar extends ui.UIComponent<typeof RK_PrizeBar, VehicleState> {
  static executionMode = 'local';

  static propsDefinition = {
        debugMode: { type: hz.PropTypes.Boolean },
        debugPrizes: { type: hz.PropTypes.Boolean },
        boxSize: { type: hz.PropTypes.Number, default: 60 },
        avatarPoseGizmo: { type: hz.PropTypes.Entity },

        mapAnchor: { type: hz.PropTypes.String, default: 'bottom-right' },
        mapOffsetX: { type: hz.PropTypes.Number, default: 20 },
        mapOffsetY: { type: hz.PropTypes.Number, default: 20 },
        mapWidth: { type: hz.PropTypes.Number, default: 450 },
        mapHeight: { type: hz.PropTypes.Number, default: 100 },

        prize1AssetId: { type: hz.PropTypes.String },
        prize1Name: { type: hz.PropTypes.String, default: 'Prize 1' },
        prize2AssetId: { type: hz.PropTypes.String },
        prize2Name: { type: hz.PropTypes.String, default: 'Prize 2' },
        prize3AssetId: { type: hz.PropTypes.String },
        prize3Name: { type: hz.PropTypes.String, default: 'Prize 3' },
        prize4AssetId: { type: hz.PropTypes.String },
        prize4Name: { type: hz.PropTypes.String, default: 'Prize 4' },
        prize5AssetId: { type: hz.PropTypes.String },
        prize5Name: { type: hz.PropTypes.String, default: 'Prize 5' },

        ProjectileSpawnerEntity: { type: PropTypes.Entity },
  };

  public overlayOpacity = new ui.Binding<number>(1);

  private prizeQuantities: number[] = [0, 0, 0, 0, 0];
  private prizeBindings: ui.Binding<string>[] = [];
  private imageOpacityBindings: ui.Binding<number>[] = [];
  private borderBindings: ui.Binding<string>[] = [];
  private borderWidthBindings: ui.Binding<number>[] = [];

  private selectedPrizeIndex: number = -1;
  private sittingPlayerId?: number;

  private spawnButtonInput?: PlayerInput;
  private selectInput?: PlayerInput;

  private vehicleId: string = "123";

  private bindLocalInput() {
        this.disconnectInput();

        const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);

        this.spawnButtonInput = PlayerControls.connectLocalInput(
            PlayerInputAction.LeftTertiary,
            ButtonIcon.Rocket,
            this,
            { preferredButtonPlacement: ButtonPlacement.Center }
        );

        this.spawnButtonInput?.registerCallback((action: PlayerInputAction, pressed: boolean) => {
            const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);
            if (pressed && gizmo?.player.get()?.id === this.world.getLocalPlayer().id) {
                if (this.props.debugMode) console.log(`Sending spawn event for vehicle ${this.entity.id}`);
                this.sendMessage();
            }
        });

        this.selectInput = PlayerControls.connectLocalInput(
            PlayerInputAction.LeftGrip,
            ButtonIcon.Swap,
            this,
            { preferredButtonPlacement: ButtonPlacement.Center }
        );

        this.selectInput?.registerCallback((action, pressed) => {
            if (!pressed) return;

            const available = this.prizeQuantities
                .map((q, i) => (q > 0 ? i : -1))
                .filter(i => i >= 0);

            if (!available.length) return;

            let idx = available.indexOf(this.selectedPrizeIndex);
            if (idx < 0) idx = available.indexOf(this.prizeQuantities.findIndex(q => q > 0));

            const nextIdx = (idx + 1) % available.length;
            this.setSelectedPrize(available[nextIdx]);
        });
  }

  private sendMessage() {
        if (!this.props.ProjectileSpawnerEntity) {
            console.warn('LocalMessageSender: ProjectileSpawnerEntity is not assigned.');
            return;
        }

        if (this.selectedPrizeIndex < 0) this.selectFirstAvailablePrize();

        let indexToSend = this.selectedPrizeIndex;

        if (this.prizeQuantities[indexToSend] < 1) {
            if (this.props.debugMode) console.log(`Prize ${indexToSend + 1} is empty.`);

            const available = this.prizeQuantities
                .map((q, i) => (q > 0 ? i : -1))
                .filter(i => i >= 0);

            if (!available.length) {
                if (this.props.debugMode) console.log("No prizes available to send.");
                return;
            }

            let nearest = available[0];
            let minDist = Math.abs(this.selectedPrizeIndex - nearest);

            for (const i of available) {
                const dist = Math.min(
                    Math.abs(this.selectedPrizeIndex - i),
                    this.prizeQuantities.length - Math.abs(this.selectedPrizeIndex - i)
                );
                if (dist < minDist) {
                    nearest = i;
                    minDist = dist;
                }
            }

            if (this.props.debugMode) console.log(`Switching selection to Prize ${nearest + 1}.`);
            this.setSelectedPrize(nearest);
            indexToSend = nearest;
        }

        const message = (indexToSend + 1).toString();

        this.sendNetworkEvent(
            this.props.ProjectileSpawnerEntity,
            CustomVehicleMessage,
            { vehicleId: this.vehicleId, message }
        );

        if (this.props.debugMode) console.log(`Spawn message sent for Prize ${indexToSend + 1} to ProjectileSpawner ${this.vehicleId}: "${message}"`);

        this.removePrize(indexToSend, 1);
  }

  private handleMessage = async (data: { vehicleId: string; message: string }) => {
        if (this.selectedPrizeIndex === -1) this.selectFirstAvailablePrize();

        if (this.props.debugMode) console.log(`handleMessage: [${data.vehicleId}] : ${data.message}`);

        if (data.message.startsWith("prize")) {
            const match = data.message.match(/^prize(\d)$/);
            if (match) {
                const prizeIndex = parseInt(match[1], 10) - 1;
                if (prizeIndex >= 0 && prizeIndex < 5) {
                    this.addPrize(prizeIndex, 1);
                    if (this.props.debugMode) console.log(`RK_PrizeBar: Added 1 of Prize ${prizeIndex + 1}`);
                }
            } else if (this.props.debugMode) {
                console.warn(`RK_PrizeBar: Invalid prize message format "${data.message}"`);
            }
        }
  };

  private setSelectedPrize(index: number) {
        this.selectedPrizeIndex = index;
        this.borderBindings.forEach((b, i) => {
            if (i === index) {
                b.set("green");
                this.borderWidthBindings[i].set(6);
            } else {
                b.set("transparent");
                this.borderWidthBindings[i].set(0);
            }
        });
  }

  private disconnectInput() {
        if (this.spawnButtonInput) { this.spawnButtonInput.disconnect(); this.spawnButtonInput = undefined; }
        if (this.selectInput) { this.selectInput.disconnect(); this.selectInput = undefined; }
  }

  initializeUI(): ui.UINode {
        this.prizeBindings = this.prizeQuantities.map(q => new ui.Binding<string>(q.toString()));
        this.imageOpacityBindings = this.prizeQuantities.map(q => new ui.Binding<number>(q > 0 ? 1 : 0));
        this.borderBindings = this.prizeQuantities.map(() => new ui.Binding<string>('transparent'));
        this.borderWidthBindings = this.prizeQuantities.map(() => new ui.Binding<number>(0));

        const boxes = this.prizeQuantities.map((_, i) => ui.View({
            style: {
                width: this.props.boxSize, height: this.props.boxSize,
                backgroundColor: '#222', borderRadius: 6,
                marginRight: i < 4 ? 5 : 0,
                justifyContent: 'center', alignItems: 'center', position: 'relative',
                borderWidth: this.borderWidthBindings[i],
                borderColor: this.borderBindings[i],
                opacity: this.imageOpacityBindings[i], // hide empty cells
            },
            children: [
                ui.Image({
                    source: this.getPrizeImageSource(i),
                    style: {
                        width: this.props.boxSize - 10,
                        height: this.props.boxSize - 10,
                        resizeMode: 'contain',
                        opacity: this.imageOpacityBindings[i]
                    },
                }),
                ui.Text({
                    text: this.prizeBindings[i],
                    style: {
                        position: 'absolute', top: 4, right: 4,
                        color: '#cdcdcd', fontSize: 16, fontWeight: 'bold',
                        textShadowColor: '#000', textShadowRadius: 3
                    },
                }),
                ui.View({
                    style: { position: 'absolute', bottom: 2, left: 0, right: 0, alignItems: 'center' },
                    children: [
                        ui.Text({
                            text: this.getPrizeName(i),
                            style: {
                                color: '#fff', fontSize: 12, textAlign: 'center',
                                textShadowColor: '#000', textShadowRadius: 2
                            }
                        })
                    ]
                }),
            ]
        }));

        const row = ui.View({ style: { flexDirection: 'row', justifyContent: 'center' }, children: boxes });

        const containerStyle: any = {
            width: this.props.mapWidth,
            height: this.props.mapHeight,
            position: 'absolute',
            justifyContent: 'center',
            alignItems: 'center',
            opacity: this.overlayOpacity
        };

        switch (this.props.mapAnchor) {
            case 'top-left': containerStyle.left = this.props.mapOffsetX; containerStyle.top = this.props.mapOffsetY; break;
            case 'top-right': containerStyle.right = this.props.mapOffsetX; containerStyle.top = this.props.mapOffsetY; break;
            case 'bottom-left': containerStyle.left = this.props.mapOffsetX; containerStyle.bottom = this.props.mapOffsetY; break;
            case 'bottom-right': containerStyle.right = this.props.mapOffsetX; containerStyle.bottom = this.props.mapOffsetY; break;
            case 'top-center': containerStyle.left = '50%'; containerStyle.top = this.props.mapOffsetY; containerStyle.marginLeft = -this.props.mapWidth / 2; break;
            case 'bottom-center': containerStyle.left = '50%'; containerStyle.bottom = this.props.mapOffsetY; containerStyle.marginLeft = -this.props.mapWidth / 2; break;
            case 'center':
                containerStyle.left = '50%';
                containerStyle.top = '50%';
                containerStyle.marginLeft = -this.props.mapWidth / 2;
                containerStyle.marginTop = -this.props.mapHeight / 2;
                break;
        }

        return ui.View({ style: containerStyle, children: [row] });
  }

  override preStart() {
      this.connectNetworkEvent(this.entity, CustomVehicleMessage, this.handleMessage);

      this.connectNetworkEvent(this.entity, RaceControlEvent, (data) => {
          if (this.props.debugMode) console.log('[RK_PrizeBar] Received race event', data);
          if (data.command === 'stop') {
              if (this.props.debugMode) console.log("Cleared prizebar");
              this.clearPrizes();
          }
      });
  }

  override start() {
      const gizmo = this.props.avatarPoseGizmo;
      if (!gizmo) return;

      this.connectCodeBlockEvent(gizmo, hz.CodeBlockEvents.OnPlayerEnterAvatarPoseGizmo, (player: Player) => this.onPlayerEnter(player));
      this.connectCodeBlockEvent(gizmo, hz.CodeBlockEvents.OnPlayerExitAvatarPoseGizmo, (player: Player) => this.onPlayerExit(player));
      this.selectFirstAvailablePrize();
  }

  private onPlayerEnter(player: Player) {
      if (this.props.debugMode) console.log("onPlayerEnter()");
      this.overlayOpacity.set(1);
      this.selectFirstAvailablePrize();
      this.entity.owner.set(player);
      try { this.bindLocalInput(); } catch { }
      
      if (this.props.debugPrizes) 
      {
        this.addPrize(0,10);
        this.addPrize(1,10);
        this.addPrize(2,10);
        this.addPrize(3,10);
        this.addPrize(4,10);
      }
  }

  private onPlayerExit(player: Player) {
      this.overlayOpacity.set(0);
      this.sittingPlayerId = undefined;
      if (this.props.debugMode) console.log("onPlayerExit()");
      this.disconnectInput();
  }

  receiveOwnership(state: VehicleState | null, fromPlayer: Player, toPlayer: Player) {
      if (toPlayer.id === this.world.getLocalPlayer().id) {
          if (this.props.debugMode) console.log('RK_Prizebar - Local player now owns vehicle, binding input');
          this.overlayOpacity.set(1);
          this.selectFirstAvailablePrize();
          this.entity.owner.set(toPlayer);
          this.bindLocalInput();
      }
  }

  private selectFirstAvailablePrize() {
      const first = this.prizeQuantities.findIndex(q => q > 0);
      if (first >= 0) this.setSelectedPrize(first);
      else {
          this.selectedPrizeIndex = -1;
          this.borderBindings.forEach(b => b.set('transparent'));
          this.borderWidthBindings.forEach(b => b.set(0));
      }
  }

  private getPrizeName(index: number): string {
      return [this.props.prize1Name, this.props.prize2Name, this.props.prize3Name, this.props.prize4Name, this.props.prize5Name][index] ?? 'Unknown';
  }

  private getPrizeImageSource(index: number): ui.ImageSource | undefined {
      const assetIdStr = [this.props.prize1AssetId, this.props.prize2AssetId, this.props.prize3AssetId, this.props.prize4AssetId, this.props.prize5AssetId][index];
      return assetIdStr ? ui.ImageSource.fromTextureAsset(new TextureAsset(BigInt(assetIdStr))) : undefined;
  }

  addPrize(index: number, amount: number = 1) {
      if (index < 0 || index > 4) return;
      this.prizeQuantities[index] += amount;
      this.prizeBindings[index].set(this.prizeQuantities[index].toString());
      this.imageOpacityBindings[index].set(this.prizeQuantities[index] > 0 ? 1 : 0);
      if (this.selectedPrizeIndex < 0 || this.prizeQuantities[this.selectedPrizeIndex] === 0) this.selectFirstAvailablePrize();
  }

  removePrize(index: number, amount: number = 1) {
      if (index < 0 || index > 4) return;
      this.prizeQuantities[index] = Math.max(0, this.prizeQuantities[index] - amount);
      this.prizeBindings[index].set(this.prizeQuantities[index].toString());
      this.imageOpacityBindings[index].set(this.prizeQuantities[index] > 0 ? 1 : 0);
      if (this.selectedPrizeIndex < 0 || this.prizeQuantities[this.selectedPrizeIndex] === 0) this.selectFirstAvailablePrize();
  }

  clearPrizes() {
      this.prizeQuantities.forEach((_, i) => {
          this.prizeBindings[i]?.set("0");
          this.imageOpacityBindings[i]?.set(0);
          this.borderBindings[i]?.set("transparent");
          this.borderWidthBindings[i]?.set(0);
      });
      this.selectedPrizeIndex = -1;
      if (this.props.debugMode) console.log("[RK_PrizeBar] All prizes cleared");
  }

  override dispose() {
      this.disconnectInput();
  }
}

hz.Component.register(RK_PrizeBar);


/////////////////////////////////////////////////////////////////////////////////////////
// Racing Kit for Meta Horizons
// UI 'position overlay' script with server time sync & delayed action queue
/////////////////////////////////////////////////////////////////////////////////////////

export type RaceOverlayState = {
  currentLap: number;
  totalLaps: number;
  raceActive: boolean;
  finished: boolean;
  raceStartTime: number;   // 0 if not started
  prevRaceActive: boolean;
  serverTime: number;
  currentPosition: number;
  prevIndex: number;
};

export class RK_RacePositionOverlay extends ui.UIComponent<typeof RK_RacePositionOverlay, RaceOverlayState> {
  static executionMode = 'local';

  static propsDefinition = {
    avatarPoseGizmo: { type: PropTypes.Entity },

    overlayAnchor: { type: PropTypes.String, default: 'top-right' },
    overlayOffsetX: { type: PropTypes.Number, default: 20 },
    overlayOffsetY: { type: PropTypes.Number, default: 20 },
    overlayWidth: { type: PropTypes.Number, default: 400 },
    overlayHeight: { type: PropTypes.Number, default: 300 },
    debugMode: { type: PropTypes.Boolean, default: false },

    texture0: { type: PropTypes.Asset, default: null },
    texture1: { type: PropTypes.Asset, default: null },
    texture2: { type: PropTypes.Asset, default: null },
    texture3: { type: PropTypes.Asset, default: null },
    texture4: { type: PropTypes.Asset, default: null },
    texture5: { type: PropTypes.Asset, default: null },
    texture6: { type: PropTypes.Asset, default: null },
    texture7: { type: PropTypes.Asset, default: null },
    texture8: { type: PropTypes.Asset, default: null },

    selectedTexture: { type: PropTypes.Number, default: 0 }, // 0-8
    
    upSound: { type: PropTypes.Entity },  
    downSound: { type: PropTypes.Entity },  
    
    updateInterval: { type: PropTypes.Number, default: 1.0 },
  };

  private overlayNode!: ui.UINode;
  private overlayOpacity = new ui.Binding<number>(0);
  private textureNodes: { node: ui.UINode; opacity: ui.Binding<number> }[] = [];
  private upAudioGizmo?: AudioGizmo;
  private downAudioGizmo?: AudioGizmo;

  private prevIndex: number = 0;

  private lapLabelNode?: ui.UINode;
  private currentLap: number = 0;
  private totalLaps: number = 0;
  private raceActive: boolean = false;  
  private finished: boolean = false;
  
  private raceStartTime: number | null = null;
  private timerBinding = new ui.Binding<string>('00:00:00.000');
  private prevRaceActive: boolean = false;
  private lastTimerUpdate = 0;

  // time sync fields
  private serverTime: number = 0;  // server ms snapshot
  private clientTime: number = 0;  // local ms snapshot at sync

  private lapTextBinding = new ui.Binding<string>('Lap 0 / 0');
  private currentPosition: number = 0;

  // ------------------ DELAYED ACTION QUEUE ------------------
  private delayedActions: { delay: number; action: () => void }[] = [];

  private enqueueDelayedAction(action: () => void, delayMs: number) {
    this.delayedActions.push({ action, delay: delayMs });
  }

  // ------------------ NETWORK EVENTS ------------------
  override preStart() {
    this.connectNetworkEvent(this.entity, VehiclePositionEvent, this.handlePositionUpdate);
    this.connectNetworkEvent(this.entity, VehicleProgressEvent, this.handleLapUpdate);

    const syncTimeEvent = new hz.NetworkEvent<{ timestamp: number }>('syncTime');
    this.connectNetworkBroadcastEvent(syncTimeEvent, this.updateServerTime.bind(this));

    this.lapTextBinding.set(`Lap 0 / ${this.totalLaps || 3}`);
  }

  private handlePositionUpdate = (data: { position: number }) => {
    this.setTexture(data.position);
  };

  // ------------------ TIME SYNC ------------------
  public updateServerTime(data: { timestamp: number }) {
    this.serverTime = data.timestamp;   // authoritative ms
    this.clientTime = Date.now();       // local snapshot
    if (this.props.debugMode) {
      // console.log(`[Overlay] Server time synced: server=${this.serverTime}, client=${this.clientTime}`); //too spammy
    }
  }

  private getCurrentTime(): number {
    return this.serverTime + (Date.now() - this.clientTime);
  }

  // ------------------ TIMER ------------------
  private updateTimer() {
    if (this.raceStartTime === null || !this.raceActive) return;

    const elapsed = this.getCurrentTime() - this.raceStartTime;
    const ms = Math.floor(elapsed % 1000);
    const totalSeconds = Math.floor(elapsed / 1000);
    const secs = totalSeconds % 60;
    const mins = Math.floor(totalSeconds / 60) % 60;
    const hrs = Math.floor(totalSeconds / 3600);

    this.timerBinding.set(
      `${hrs.toString().padStart(2,'0')}:${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`
    );
  }

  private resetTimer() {
    this.raceStartTime = null;
    this.timerBinding.set('00:00:00.000');
  }

  // ------------------ START ------------------
  override start() {
    // Register gizmo enter/exit
    const gizmoEntity = this.props.avatarPoseGizmo;
    if (gizmoEntity) {
      this.connectCodeBlockEvent(gizmoEntity, CodeBlockEvents.OnPlayerEnterAvatarPoseGizmo,
        (player: Player) => this.onPlayerEnter(player));
      this.connectCodeBlockEvent(gizmoEntity, CodeBlockEvents.OnPlayerExitAvatarPoseGizmo,
        (player: Player) => this.onPlayerExit(player));
    }

    if (this.props.upSound) this.upAudioGizmo = this.props.upSound.as(AudioGizmo);
    if (this.props.downSound) this.downAudioGizmo = this.props.downSound.as(AudioGizmo);

    // Main update loop (timer + delayed actions)
    this.connectLocalBroadcastEvent(hz.World.onUpdate, (data: { deltaTime: number }) => {
      const deltaMs = data.deltaTime * 1000;

      // process delayed actions
      for (let i = this.delayedActions.length - 1; i >= 0; i--) {
        const item = this.delayedActions[i];
        item.delay -= deltaMs;
        if (item.delay <= 0) {
          item.action();
          this.delayedActions.splice(i, 1);
        }
      }

      // timer update
      if (this.raceActive && this.raceStartTime !== null) {
        const now = Date.now();
        if (now - this.lastTimerUpdate >= this.props.updateInterval * 1000) {
          this.updateTimer();
          this.lastTimerUpdate = now;
        }
      }
    });
  }

  // ------------------ PLAYER ENTER/EXIT ------------------ 
  private onPlayerEnter(player: Player) {
    if (this.props.debugMode) console.log('RK_RacePositionOverlay: onPlayerEnter', player.name.get());
  
    // Delayed action for overlay + texture
    this.enqueueDelayedAction(() => {
      this.overlayOpacity.set(1);
      this.setTexture(this.prevIndex);
    }, 50);
  }

  private onPlayerExit(player: Player) {
    if (this.props.debugMode) console.log('RK_RacePositionOverlay: onPlayerExit', player.name.get());
      this.enqueueDelayedAction(() => {
      this.overlayOpacity.set(0);

      // ? reset bindings so no stale data leaks
      this.lapTextBinding.set('');
      this.timerBinding.set('00:00:00.000');
      this.setTexture(0);
    }, 50);
  }

  // ------------------ OWNERSHIP ------------------
  receiveOwnership(state: RaceOverlayState | null, fromPlayer: Player, toPlayer: Player) {
    this.enqueueDelayedAction(() => {
      if (toPlayer.id === this.world.getLocalPlayer().id) {
        if (this.props.debugMode) console.log('Local player now owns overlay');
        this.overlayOpacity.set(1);

        if (state) {
          this.currentLap = state.currentLap;
          this.totalLaps = state.totalLaps;
          this.raceActive = state.raceActive;
          this.finished = state.finished;
          this.raceStartTime = state.raceStartTime > 0 ? state.raceStartTime : null;
          this.prevRaceActive = state.prevRaceActive;
          this.serverTime = state.serverTime;
          this.currentPosition = state.currentPosition;
          this.prevIndex = state.prevIndex;

          this.lapTextBinding.set(`Lap ${this.currentLap} / ${this.totalLaps}`);
          this.setTexture(this.currentPosition);

          if (this.raceActive && this.raceStartTime === null) {
            this.raceStartTime = this.getCurrentTime();
          }
        }
      } else {
        this.overlayOpacity.set(0);
      }
    }, 50);
  }

  transferOwnership(fromPlayer: Player, toPlayer: Player): RaceOverlayState {
    this.enqueueDelayedAction(() => {
      if (toPlayer.id === this.world.getLocalPlayer().id) {
        this.overlayOpacity.set(1);
        if (this.raceActive && this.raceStartTime === null) {
          this.raceStartTime = this.getCurrentTime();
        }
      } else {
        this.overlayOpacity.set(0);
      }
    }, 50);

    return {
      currentLap: this.currentLap,
      totalLaps: this.totalLaps,
      raceActive: this.raceActive,
      finished: this.finished,
      raceStartTime: this.raceStartTime ?? 0,
      prevRaceActive: this.prevRaceActive,
      serverTime: this.serverTime,
      currentPosition: this.prevIndex,
      prevIndex: this.prevIndex
    };
  }

  // ------------------ UI -------------------
  initializeUI(): ui.UINode {
    const { width: sw, height: sh } = { width: this.panelWidth, height: this.panelHeight };
    const w = this.props.overlayWidth;
    const h = this.props.overlayHeight;
    const ox = this.props.overlayOffsetX;
    const oy = this.props.overlayOffsetY;

    let left = 0;
    let top = 0;
    switch (this.props.overlayAnchor) {
      case 'top-left': left = ox; top = oy; break;
      case 'top-right': left = sw - w - ox; top = oy; break;
      case 'bottom-left': left = ox; top = sh - h - oy; break;
      case 'bottom-right': left = sw - w - ox; top = sh - h - oy; break;
      case 'center': left = (sw - w) / 2; top = (sh - h) / 2; break;
      case 'center-left': left = ox; top = (sh - h) / 2; break;
      case 'center-right': left = sw - w - ox; top = (sh - h) / 2; break;
      case 'center-top': left = (sw - w) / 2; top = oy; break;
      case 'center-bottom': left = (sw - w) / 2; top = sh - h - oy; break;
      case 'center-only': left = (sw - w) / 2; top = (sh - h) / 2; break;
    }

    const textures: (TextureAsset | null)[] = [
      this.props.texture0, this.props.texture1, this.props.texture2, this.props.texture3,
      this.props.texture4, this.props.texture5, this.props.texture6, this.props.texture7,
      this.props.texture8
    ];

    this.textureNodes = [];
    const textureNodes = textures.map((tex, i) => {
      const opacityBinding = new ui.Binding<number>(i === this.props.selectedTexture ? 1 : 0);
      const node = ui.Image({
        source: tex ? ImageSource.fromTextureAsset(tex) : undefined,
        style: { width: w, height: h, left: 0, top: 0, position: 'absolute', opacity: opacityBinding }
      });
      this.textureNodes.push({ node, opacity: opacityBinding });
      return node;
    });

    this.lapLabelNode = ui.Text({
      text: this.lapTextBinding,
      style: { position: 'absolute', left: 20, top: 100, fontSize: 32, color: 'white', fontWeight: 'bold' }
    });

    const timerNode = ui.Text({
      text: this.timerBinding,
      style: { position: 'absolute', left: 20, top: 150, fontSize: 28, color: 'yellow', fontWeight: 'bold' }
    });

    const overlayContainer = ui.View({
      style: { width: w, height: h, left, top, position: 'absolute' },
      children: [...textureNodes, this.lapLabelNode, timerNode]
    });

    this.overlayNode = ui.View({
      style: { width: sw, height: sh, position: 'absolute', opacity: this.overlayOpacity },
      children: [overlayContainer]
    });

    return this.overlayNode;
  }

  // ------------------ LAP UPDATE ------------------
  private handleLapUpdate = (data: { lap: number; lapCount: number; raceActive: boolean; finished: boolean }) => {
    this.currentLap = data.lap;
    this.totalLaps = data.lapCount;
    this.raceActive = data.raceActive;
    this.finished = data.finished;

    this.lapTextBinding.set(`Lap ${this.currentLap} / ${this.totalLaps}`);

    if (!this.raceActive) {
      this.setTexture(0);
      this.lapTextBinding.set('');
      this.resetTimer();
      this.prevRaceActive = false;
      this.timerBinding.set('00:00:00.000');
    } else {
      if (!this.prevRaceActive) {
        this.resetTimer();
        this.raceStartTime = this.getCurrentTime();
        this.lastTimerUpdate = 0;
      }

      if (this.finished && this.raceStartTime !== null) {
        this.resetTimer();
      }

      this.prevRaceActive = this.raceActive;
    }
  };

  // ------------------ TEXTURE ------------------
  public setTexture(index: number) {
    if (index < 0) index = 0;
    if (index >= this.textureNodes.length) index = this.textureNodes.length - 1;

    const gizmo = this.props.avatarPoseGizmo?.as(AvatarPoseGizmo);

    this.textureNodes.forEach((t, i) => {
      t.opacity.set(i === index ? 1 : 0);
    });

    if (index !== this.prevIndex) {
      if (index < this.prevIndex) {
        if (this.upAudioGizmo && gizmo?.player.get()?.id === this.world.getLocalPlayer().id) {
          this.upAudioGizmo.play();
        }
      } else {
        if (this.downAudioGizmo && gizmo?.player.get()?.id === this.world.getLocalPlayer().id) {
          this.downAudioGizmo.play();
        }
      }
    }

    this.prevIndex = index;
  }
}

hz.Component.register(RK_RacePositionOverlay);


/////////////////////////////////////////////////////////////////////////////////////////
// RK_CameraToggleLocal
// for spectators use
/////////////////////////////////////////////////////////////////////////////////////////

const ClickEvent = new hz.NetworkEvent<{ playerId: number }>('ClickEvent');

class RK_CameraToggleLocal extends hz.Component<typeof RK_CameraToggleLocal, {}> {
  static executionMode = 'local';
  static propsDefinition = {
    useFirstPerson: { type: hz.PropTypes.Boolean, default: true },
    debugMode: { type: PropTypes.Boolean, default: false },
  };

  start() {
    this.connectCodeBlockEvent(
      this.entity,
      hz.CodeBlockEvents.OnPlayerEnterTrigger,
      (player: Player) => {
          
          this.entity.owner.set(player);
          
          if (this.props.debugMode) console.log("Clicked Trigger: " + player.id.toString() + " :: " + this.world.getLocalPlayer().id);

          const options: CameraTransitionOptions = {
            duration: 0.01,
            easing: Easing.EaseInOut,
          };
          
          if (player.id === this.world.getLocalPlayer().id)
          {
            if (this.props.useFirstPerson) {
              if (this.props.debugMode) console.log("Switched Cam Mode: 1st");
              LocalCamera.setCameraModeFirstPerson(options);
            } else {
              if (this.props.debugMode) console.log("Switched Cam Mode: 3rd");
              LocalCamera.setCameraModeThirdPerson(options);
            }
          }
      }
    );
  }
}

hz.Component.register(RK_CameraToggleLocal);

