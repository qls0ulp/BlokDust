/// <reference path="./lib/exjs/dist/ex.d.ts"/>
import Config = require("./Config");
import OperationManager = require("./Core/Operations/OperationManager");
import ResourceManager = require("./Core/Resources/ResourceManager");
import CommandManager = require("./Core/Commands/CommandManager");
import AudioMixer = require("./Core/Audio/AudioMixer");
import InputManager = require("./Core/Inputs/InputManager");
import KeyboardInput = require("./Core/Inputs/KeyboardInputManager");
import CommandsInputManager = require("./Core/Inputs/CommandsInputManager");
import PointerInputManager = require("./Core/Inputs/PointerInputManager");
import IEffect = require("./Blocks/IEffect");
import ISource = require("./Blocks/ISource");
import IBlock = require("./Blocks/IBlock");
import DisplayObjectCollection = require("./DisplayObjectCollection");
import Particle = require("./Particle");
import Fonts = require("./UI/Fonts");
import Oscillator = require("./PooledOscillator");
import PooledFactoryResource = require("./Core/Resources/PooledFactoryResource");
import Serializer = require("./Serializer");
import Grid = require("./Grid");
import BlocksSketch = require("./BlocksSketch");
import Commands = require("./Commands");
import CommandHandlerFactory = require("./Core/Resources/CommandHandlerFactory");
import CreateBlockCommandHandler = require("./CommandHandlers/CreateBlockCommandHandler");
import DeleteBlockCommandHandler = require("./CommandHandlers/DeleteBlockCommandHandler");
import MoveBlockCommandHandler = require("./CommandHandlers/MoveBlockCommandHandler");
import IncrementNumberCommandHandler = require("./CommandHandlers/IncrementNumberCommandHandler");
import SaveCommandHandler = require("./CommandHandlers/SaveCommandHandler");
import SaveAsCommandHandler = require("./CommandHandlers/SaveAsCommandHandler");
import LoadCommandHandler = require("./CommandHandlers/LoadCommandHandler");
import UndoCommandHandler = require("./CommandHandlers/UndoCommandHandler");
import RedoCommandHandler = require("./CommandHandlers/RedoCommandHandler");
import DisplayList = require("./DisplayList");
import Source = require("./Blocks/Source");
import Effect = require("./Blocks/Effect");
import IApp = require("./IApp");
import SaveFile = require("./SaveFile");
import ObservableCollection = Fayde.Collections.ObservableCollection;
import SketchSession = Fayde.Drawing.SketchSession;

declare var PixelPalette;

class App implements IApp{

    private _Canvas: HTMLCanvasElement;
    private _ClockTimer: Fayde.ClockTimer = new Fayde.ClockTimer();
    private _SaveFile: SaveFile;
    public AudioMixer: AudioMixer = new AudioMixer();
    public Blocks: IBlock[] = [];
    public BlocksSketch: BlocksSketch;
    public CommandManager: CommandManager;
    public CommandsInputManager: CommandsInputManager;
    public CompositionId: string;
    public Config: Config;
    public InputManager: InputManager;
    public KeyboardInput: KeyboardInput;
    public OperationManager: OperationManager;
    public OscillatorsPool: PooledFactoryResource<Oscillator>;
    public Palette: string[] = [];
    public Particles: Particle[] = [];
    public ParticlesPool: PooledFactoryResource<Particle>;
    public PointerInputManager: PointerInputManager;
    public ResourceManager: ResourceManager;
    private _SessionId: string;

    get Sources(): IBlock[] {
        return this.Blocks.en().where(b => b instanceof Source).toArray();
    }

    get Effects(): IBlock[] {
        return this.Blocks.en().where(b => b instanceof Effect).toArray();
    }

    get SessionId(): string {
        return this._SessionId || localStorage.getItem(this.CompositionId);
    }

    set SessionId(value: string) {
        this._SessionId = value;
        localStorage.setItem(this.CompositionId, this._SessionId);
    }

    constructor(config: string) {
        this.Config = <Config>JSON.parse(config);
    }

    public Setup(){

        this.CreateCanvas();

        // resize
        window.onresize = () => {
            this.Resize();
        }

        this.OperationManager = new OperationManager();
        this.OperationManager.MaxOperations = this.Config.MaxOperations;
        this.ResourceManager = new ResourceManager();
        this.CommandManager = new CommandManager(this.ResourceManager);
        //this.Fonts = new Fonts();

        // register command handlers
        this.ResourceManager.AddResource(new CommandHandlerFactory(Commands[Commands.CREATE_BLOCK], CreateBlockCommandHandler.prototype));
        this.ResourceManager.AddResource(new CommandHandlerFactory(Commands[Commands.DELETE_BLOCK], DeleteBlockCommandHandler.prototype));
        this.ResourceManager.AddResource(new CommandHandlerFactory(Commands[Commands.MOVE_BLOCK], MoveBlockCommandHandler.prototype));
        this.ResourceManager.AddResource(new CommandHandlerFactory(Commands[Commands.SAVE], SaveCommandHandler.prototype));
        this.ResourceManager.AddResource(new CommandHandlerFactory(Commands[Commands.SAVEAS], SaveAsCommandHandler.prototype));
        this.ResourceManager.AddResource(new CommandHandlerFactory(Commands[Commands.LOAD], LoadCommandHandler.prototype));
        this.ResourceManager.AddResource(new CommandHandlerFactory(Commands[Commands.UNDO], UndoCommandHandler.prototype));
        this.ResourceManager.AddResource(new CommandHandlerFactory(Commands[Commands.REDO], RedoCommandHandler.prototype));

        // create input managers
        this.InputManager = new InputManager();
        this.KeyboardInput = new KeyboardInput();
        this.CommandsInputManager = new CommandsInputManager(this.CommandManager);
        this.PointerInputManager = new PointerInputManager();

        this.ParticlesPool = new PooledFactoryResource<Particle>(10, 100, Particle.prototype);
        this.OscillatorsPool = new PooledFactoryResource<Oscillator>(10, 100, Oscillator.prototype);

        var pixelPalette = new PixelPalette(this.Config.PixelPaletteImagePath);

        pixelPalette.Load((palette: string[]) => {
            this.Palette = palette;
            this.LoadComposition();
        });

        // SOUNDCLOUD //
        // todo: create server-side session
        if (typeof(SC) !== "undefined"){
            SC.initialize({
                client_id: this.Config.SoundCloudClientId
            });
        }
    }

    LoadComposition() {
        this.CompositionId = Utils.Urls.GetQuerystringParameter('c');

        if(this.CompositionId) {
            this.CommandManager.ExecuteCommand(Commands[Commands.LOAD], this.CompositionId).then((data) => {
                // get deserialized blocks tree, then "flatten" so that all blocks are in an array
                this.Deserialize(data);
                this.CreateUI();
                this.RefreshBlocks();
            });
        } else {
            this.CreateUI();
            this.RefreshBlocks();
        }
    }

    CreateUI() {
        // create BlocksSketch
        this.BlocksSketch = new BlocksSketch();

        // set initial zoom level/position
        if (this._SaveFile) {
            this.BlocksSketch.ZoomLevel = this._SaveFile.ZoomLevel;
            this.BlocksSketch.ZoomPosition = new Point(this._SaveFile.ZoomPosition.x, this._SaveFile.ZoomPosition.y);
        }

        // initialise blocks (give them a ctx to draw to)
        this.Blocks.forEach((b: IBlock) => {
            b.Init(this.BlocksSketch);
        });

        // add blocks to BlocksSketch DisplayList
        var d = new DisplayObjectCollection();
        d.AddRange(this.Blocks);
        this.BlocksSketch.DisplayList = new DisplayList(d);

        // set up animation loop
        this._ClockTimer.RegisterTimer(this);

        this.Resize();
    }

    RefreshBlocks() {
        // refresh all Sources (reconnects Effects).
        this.Blocks.forEach((b: ISource) => {
            b.Refresh();
        });
    }

    OnTicked (lastTime: number, nowTime: number) {
        this.BlocksSketch.SketchSession = new SketchSession(this._Canvas, this._Canvas.width, this._Canvas.height, nowTime);
        this.Update();
        this.Draw();
    }

    Update() : void {
        this.BlocksSketch.Update();
    }

    Draw(): void {
        this.BlocksSketch.Draw();
    }

    Serialize(): string {
        return Serializer.Serialize();
    }

    Deserialize(json: string): any {
        this._SaveFile = Serializer.Deserialize(json);
        this.Blocks = this._SaveFile.Composition.en().traverseUnique(block => (<IEffect>block).Sources || (<ISource>block).Effects).toArray();
    }

    //Message(string?: string, seconds?: number, confirmation?: boolean, buttonText?: string, buttonEvent?: any) {
    //    this.BlocksSketch.MessagePanel.NewMessage(string,seconds,confirmation,buttonText,buttonEvent);
    //}

    Message(string?: string, options?: any) {
        this.BlocksSketch.MessagePanel.NewMessage(string, options);
    }

    get PixelRatio(): number {
        const ctx:any = document.createElement("canvas").getContext("2d");
        const dpr = window.devicePixelRatio || 1;
        const bsr = ctx.webkitBackingStorePixelRatio ||
                ctx.mozBackingStorePixelRatio ||
                ctx.msBackingStorePixelRatio ||
                ctx.oBackingStorePixelRatio ||
                ctx.backingStorePixelRatio || 1;

        return dpr / bsr;
    }

    CreateCanvas() {
        this._Canvas = document.createElement("canvas");
        document.body.appendChild(this._Canvas);
    }

    Resize(): void {
        const canvas = this._Canvas;
        const ratio = this.PixelRatio;
        const width = window.innerWidth;
        const height = window.innerHeight;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        (<any>canvas).getContext("2d").setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    TranslateMousePointToPixelRatioPoint(point: Point){
        point.x *= this.PixelRatio;
        point.y *= this.PixelRatio;
    }
}

export = App;
