--[[
    ============================================================
    MonochromeUI v3.1
    Mobile / Stable / Fixed Edition
    ============================================================

    Core API

        local Library = ...

        local Window = Library:CreateWindow({
            Name = "SYSTEM",
            ToggleKey = Enum.KeyCode.RightShift,
            Theme = "Dark",
            Scale = 0.80,
        })

        local Tab = Window:CreateTab("HOME", "⌂")
        local Section = Tab:CreateSection("General")

        Section:CreateLabel({...})
        Section:CreateButton({...})
        Section:CreateToggle({...})
        Section:CreateSlider({...})
        Section:CreateDropdown({...})
        Section:CreateTextbox({...})
        Section:CreateKeybind({...})
        Section:CreateColorPicker({...})
        Section:CreateDivider()

    Notes
        - Mobile-friendly sizing and touch input.
        - Search filters component rows.
        - Theme changes propagate to registered objects.
        - Connection and tween cleanup are centralized.
        - Window / Tab / Section destruction is safe.
]]

-- ============================================================
-- Services
-- ============================================================

local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local LocalPlayer = Players.LocalPlayer

-- ============================================================
-- Utility
-- ============================================================

local function DeepCopy(value)
    if type(value) ~= "table" then
        return value
    end

    local result = {}

    for key, item in pairs(value) do
        result[key] = DeepCopy(item)
    end

    return result
end

local function Merge(base, override)
    local result = DeepCopy(base)

    if type(override) ~= "table" then
        return result
    end

    for key, value in pairs(override) do
        if type(value) == "table" and type(result[key]) == "table" then
            result[key] = Merge(result[key], value)
        else
            result[key] = value
        end
    end

    return result
end

local function Create(className, properties, children)
    local object = Instance.new(className)

    if properties then
        for property, value in pairs(properties) do
            if property ~= "Parent" then
                pcall(function()
                    object[property] = value
                end)
            end
        end
    end

    if children then
        for _, child in ipairs(children) do
            if child then
                child.Parent = object
            end
        end
    end

    if properties and properties.Parent then
        object.Parent = properties.Parent
    end

    return object
end

local function SafeCallback(callback, ...)
    if typeof(callback) ~= "function" then
        return
    end

    local args = table.pack(...)

    task.spawn(function()
        local ok, err = pcall(function()
            callback(table.unpack(args, 1, args.n))
        end)

        if not ok then
            warn("[MonochromeUI] Callback error:", err)
        end
    end)
end

local function Tween(object, info, properties)
    if not object or not object.Parent then
        return
    end

    local tween = TweenService:Create(
        object,
        info or TweenInfo.new(
            0.20,
            Enum.EasingStyle.Quad,
            Enum.EasingDirection.Out
        ),
        properties
    )

    tween:Play()
    return tween
end

local function IsActivateInput(input)
    return input.UserInputType == Enum.UserInputType.MouseButton1
        or input.UserInputType == Enum.UserInputType.Touch
end

local function IsPointerMovement(input)
    return input.UserInputType == Enum.UserInputType.MouseMovement
        or input.UserInputType == Enum.UserInputType.Touch
end

local function FormatNumber(value)
    value = tonumber(value) or 0

    if math.abs(value - math.round(value)) < 0.000001 then
        return tostring(math.round(value))
    end

    return string.format("%.3f", value)
        :gsub("0+$", "")
        :gsub("%.$", "")
end

local function ClampColor(color)
    if typeof(color) ~= "Color3" then
        return Color3.new(1, 1, 1)
    end

    return Color3.new(
        math.clamp(color.R, 0, 1),
        math.clamp(color.G, 0, 1),
        math.clamp(color.B, 0, 1)
    )
end

local function ColorBytes(color)
    color = ClampColor(color)

    return math.round(color.R * 255),
        math.round(color.G * 255),
        math.round(color.B * 255)
end

-- ============================================================
-- Connection Manager
-- ============================================================

local ConnectionManager = {}
ConnectionManager.__index = ConnectionManager

function ConnectionManager.new()
    return setmetatable({
        Connections = {},
    }, ConnectionManager)
end

function ConnectionManager:Connect(signal, callback)
    if not signal or typeof(callback) ~= "function" then
        return
    end

    local connection = signal:Connect(callback)

    table.insert(self.Connections, connection)
    return connection
end

function ConnectionManager:Add(connection)
    if connection then
        table.insert(self.Connections, connection)
    end

    return connection
end

function ConnectionManager:Disconnect(connection)
    if not connection then
        return
    end

    pcall(function()
        connection:Disconnect()
    end)

    for index, item in ipairs(self.Connections) do
        if item == connection then
            table.remove(self.Connections, index)
            break
        end
    end
end

function ConnectionManager:Clear()
    for _, connection in ipairs(self.Connections) do
        pcall(function()
            connection:Disconnect()
        end)
    end

    table.clear(self.Connections)
end

-- ============================================================
-- Animation Manager
-- ============================================================

local AnimationManager = {}
AnimationManager.__index = AnimationManager

function AnimationManager.new()
    return setmetatable({
        Active = {},
    }, AnimationManager)
end

function AnimationManager:Play(object, info, properties, key)
    if not object then
        return
    end

    key = key or tostring(object)

    local previous = self.Active[key]

    if previous then
        pcall(function()
            previous:Cancel()
        end)
    end

    local tween = Tween(object, info, properties)

    if tween then
        self.Active[key] = tween

        tween.Completed:Connect(function()
            if self.Active[key] == tween then
                self.Active[key] = nil
            end
        end)
    end

    return tween
end

function AnimationManager:Cancel(key)
    local tween = self.Active[key]

    if not tween then
        return
    end

    pcall(function()
        tween:Cancel()
    end)

    self.Active[key] = nil
end

function AnimationManager:Destroy()
    for key, tween in pairs(self.Active) do
        pcall(function()
            tween:Cancel()
        end)

        self.Active[key] = nil
    end
end

-- ============================================================
-- Themes
-- ============================================================

local Themes = {}

Themes.Dark = {
    Background = Color3.fromRGB(6, 6, 6),
    Topbar = Color3.fromRGB(11, 11, 11),
    Sidebar = Color3.fromRGB(9, 9, 9),

    ElementBG = Color3.fromRGB(17, 17, 17),
    ElementHover = Color3.fromRGB(27, 27, 27),
    ElementPressed = Color3.fromRGB(35, 35, 35),

    Track = Color3.fromRGB(31, 31, 31),
    Stroke = Color3.fromRGB(43, 43, 43),

    Accent = Color3.fromRGB(255, 255, 255),
    AccentDark = Color3.fromRGB(190, 190, 190),

    TextPrimary = Color3.fromRGB(242, 242, 242),
    TextSecondary = Color3.fromRGB(145, 145, 145),
    TextDisabled = Color3.fromRGB(75, 75, 75),

    Success = Color3.fromRGB(135, 210, 135),
    Warning = Color3.fromRGB(225, 185, 90),
    Error = Color3.fromRGB(220, 105, 105),

    Font = Enum.Font.Gotham,
    TitleFont = Enum.Font.GothamMedium,

    CornerRadius = UDim.new(0, 5),
}

Themes.Light = {
    Background = Color3.fromRGB(244, 244, 244),
    Topbar = Color3.fromRGB(250, 250, 250),
    Sidebar = Color3.fromRGB(235, 235, 235),

    ElementBG = Color3.fromRGB(232, 232, 232),
    ElementHover = Color3.fromRGB(220, 220, 220),
    ElementPressed = Color3.fromRGB(210, 210, 210),

    Track = Color3.fromRGB(205, 205, 205),
    Stroke = Color3.fromRGB(190, 190, 190),

    Accent = Color3.fromRGB(25, 25, 25),
    AccentDark = Color3.fromRGB(65, 65, 65),

    TextPrimary = Color3.fromRGB(20, 20, 20),
    TextSecondary = Color3.fromRGB(95, 95, 95),
    TextDisabled = Color3.fromRGB(155, 155, 155),

    Success = Color3.fromRGB(70, 145, 70),
    Warning = Color3.fromRGB(170, 125, 45),
    Error = Color3.fromRGB(180, 70, 70),

    Font = Enum.Font.Gotham,
    TitleFont = Enum.Font.GothamMedium,

    CornerRadius = UDim.new(0, 5),
}

-- ============================================================
-- Library
-- ============================================================

local Library = {}
Library.__index = Library

Library.Name = "MonochromeUI"
Library.Version = "3.1.0"
Library.Themes = Themes
Library.DefaultTheme = "Dark"
Library.Windows = {}

-- ============================================================
-- Component Base
-- ============================================================

local Component = {}
Component.__index = Component

function Component.new(window, object)
    return setmetatable({
        Window = window,
        Object = object,
        Connections = ConnectionManager.new(),
        Destroyed = false,
        SearchTitle = "",
        ThemeRefresh = nil,
    }, Component)
end

function Component:Connect(signal, callback)
    if self.Destroyed then
        return
    end

    return self.Connections:Connect(signal, callback)
end

function Component:_Connect(signal, callback)
    return self:Connect(signal, callback)
end

function Component:Destroy()
    if self.Destroyed then
        return
    end

    self.Destroyed = true
    self.Connections:Clear()

    if self.Object then
        pcall(function()
            self.Object:Destroy()
        end)
    end
end

-- ============================================================
-- Section
-- ============================================================

local Section = {}
Section.__index = Section

function Section:_Add(component, title)
    if not component then
        return
    end

    table.insert(self.Components, component)

    if title ~= nil then
        self.Window:_RegisterSearchable(
            component,
            title
        )
    end

    return component
end

function Section:_CreateBase(height)
    return Create("Frame", {
        Size = UDim2.new(1, 0, 0, height),

        BackgroundColor3 =
            self.Window.Theme.ElementBG,

        BorderSizePixel = 0,

        Parent = self.Frame,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(0, 4),
        }),
    })
end

function Section:CreateDivider()
    local divider = Create("Frame", {
        Size = UDim2.new(1, 0, 0, 1),

        BackgroundColor3 =
            self.Window.Theme.Stroke,

        BorderSizePixel = 0,

        Parent = self.Frame,
    })

    local component = Component.new(
        self.Window,
        divider
    )

    component.ThemeRefresh = function()
        if divider.Parent then
            divider.BackgroundColor3 =
                self.Window.Theme.Stroke
        end
    end

    return self:_Add(component, "")
end

function Section:CreateLabel(config)
    config = config or {}

    local text = tostring(config.Text or "")

    local label = Create("TextLabel", {
        Size = UDim2.new(
            1,
            0,
            0,
            tonumber(config.Height) or 24
        ),

        BackgroundTransparency = 1,

        Text = text,

        TextColor3 =
            config.Color
            or self.Window.Theme.TextSecondary,

        TextSize =
            tonumber(config.TextSize)
            or 12,

        Font =
            config.Font
            or self.Window.Theme.Font,

        TextWrapped =
            config.TextWrapped ~= false,

        TextXAlignment =
            config.TextXAlignment
            or Enum.TextXAlignment.Left,

        TextYAlignment =
            config.TextYAlignment
            or Enum.TextYAlignment.Center,

        Parent = self.Frame,
    })

    local component = Component.new(
        self.Window,
        label
    )

    component.ThemeRefresh = function()
        if typeof(config.Color) ~= "Color3" then
            label.TextColor3 =
                self.Window.Theme.TextSecondary
        end
    end

    function component:SetText(value)
        label.Text = tostring(value or "")
        return self
    end

    function component:SetColor(color)
        if typeof(color) == "Color3" then
            label.TextColor3 = color
        end

        return self
    end

    return self:_Add(component, text)
end

function Section:CreateButton(config)
    config = config or {}

    local name = tostring(
        config.Name or "Button"
    )

    local button = Create("TextButton", {
        Name = name,

        Size = UDim2.new(
            1,
            0,
            0,
            tonumber(config.Height) or 34
        ),

        BackgroundColor3 =
            self.Window.Theme.ElementBG,

        BorderSizePixel = 0,

        Text = name,

        TextColor3 =
            self.Window.Theme.TextPrimary,

        TextSize =
            tonumber(config.TextSize)
            or 12,

        Font =
            config.Font
            or self.Window.Theme.Font,

        AutoButtonColor = false,

        Parent = self.Frame,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(0, 4),
        }),
    })

    local component = Component.new(
        self.Window,
        button
    )

    component.Enabled = true

    component.ThemeRefresh = function()
        if not button.Parent then
            return
        end

        button.BackgroundColor3 =
            self.Window.Theme.ElementBG

        button.TextColor3 =
            component.Enabled
            and self.Window.Theme.TextPrimary
            or self.Window.Theme.TextDisabled
    end

    component:_Connect(
        button.MouseEnter,
        function()
            if component.Enabled then
                self.Window:_Tween(
                    button,
                    nil,
                    {
                        BackgroundColor3 =
                            self.Window.Theme.ElementHover,
                    }
                )
            end
        end
    )

    component:_Connect(
        button.MouseLeave,
        function()
            if component.Enabled then
                self.Window:_Tween(
                    button,
                    nil,
                    {
                        BackgroundColor3 =
                            self.Window.Theme.ElementBG,
                    }
                )
            end
        end
    )

    component:_Connect(
        button.MouseButton1Click,
        function()
            if component.Enabled then
                SafeCallback(config.Callback)
            end
        end
    )

    function component:SetText(text)
        button.Text = tostring(text or "")
        return self
    end

    function component:SetEnabled(enabled)
        component.Enabled = enabled ~= false
        button.Active = component.Enabled
        button.Selectable = component.Enabled

        button.TextColor3 =
            component.Enabled
            and self.Window.Theme.TextPrimary
            or self.Window.Theme.TextDisabled

        if not component.Enabled then
            button.BackgroundColor3 =
                self.Window.Theme.ElementBG
        end

        return self
    end

    function component:IsEnabled()
        return component.Enabled
    end

    return self:_Add(component, name)
end

function Section:CreateToggle(config)
    config = config or {}

    local name = tostring(
        config.Name or "Toggle"
    )

    local state = config.Default == true

    local frame = self:_CreateBase(38)

    local label = Create("TextLabel", {
        Size = UDim2.new(1, -62, 1, 0),

        Position = UDim2.new(
            0,
            12,
            0,
            0
        ),

        BackgroundTransparency = 1,

        Text = name,

        TextColor3 =
            self.Window.Theme.TextPrimary,

        TextSize = 12,
        Font = self.Window.Theme.Font,

        TextXAlignment =
            Enum.TextXAlignment.Left,

        Parent = frame,
    })

    local track = Create("Frame", {
        Size = UDim2.new(0, 38, 0, 20),

        Position = UDim2.new(
            1,
            -50,
            0.5,
            -10
        ),

        BackgroundColor3 =
            self.Window.Theme.Track,

        BorderSizePixel = 0,

        Parent = frame,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(1, 0),
        }),
    })

    local knob = Create("Frame", {
        Size = UDim2.new(0, 14, 0, 14),

        Position = UDim2.new(
            0,
            3,
            0.5,
            -7
        ),

        BackgroundColor3 =
            self.Window.Theme.Accent,

        BorderSizePixel = 0,

        Parent = track,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(1, 0),
        }),
    })

    local clickArea = Create("TextButton", {
        Size = UDim2.new(1, 0, 1, 0),

        BackgroundTransparency = 1,

        Text = "",

        AutoButtonColor = false,

        Parent = frame,
    })

    local component = Component.new(
        self.Window,
        frame
    )

    component.ThemeRefresh = function()
        label.TextColor3 =
            self.Window.Theme.TextPrimary

        track.BackgroundColor3 =
            state
            and self.Window.Theme.Accent
            or self.Window.Theme.Track

        knob.BackgroundColor3 =
            state
            and self.Window.Theme.Background
            or self.Window.Theme.Accent
    end

    function component:SetState(
        value,
        fireCallback
    )
        state = value == true

        self.Window:_Tween(
            track,
            nil,
            {
                BackgroundColor3 =
                    state
                    and self.Window.Theme.Accent
                    or self.Window.Theme.Track,
            }
        )

        self.Window:_Tween(
            knob,

            TweenInfo.new(
                0.20,
                Enum.EasingStyle.Back,
                Enum.EasingDirection.Out
            ),

            {
                Position =
                    state
                    and UDim2.new(
                        1,
                        -17,
                        0.5,
                        -7
                    )
                    or UDim2.new(
                        0,
                        3,
                        0.5,
                        -7
                    ),

                BackgroundColor3 =
                    state
                    and self.Window.Theme.Background
                    or self.Window.Theme.Accent,
            },

            "ToggleKnob_" .. tostring(frame)
        )

        if fireCallback ~= false then
            SafeCallback(
                config.Callback,
                state
            )
        end

        return self
    end

    function component:GetState()
        return state
    end

    function component:Toggle()
        return self:SetState(
            not state,
            true
        )
    end

    component:_Connect(
        clickArea.MouseEnter,
        function()
            self.Window:_Tween(
                frame,
                nil,
                {
                    BackgroundColor3 =
                        self.Window.Theme.ElementHover,
                }
            )
        end
    )

    component:_Connect(
        clickArea.MouseLeave,
        function()
            self.Window:_Tween(
                frame,
                nil,
                {
                    BackgroundColor3 =
                        self.Window.Theme.ElementBG,
                }
            )
        end
    )

    component:_Connect(
        clickArea.MouseButton1Click,
        function()
            component:Toggle()
        end
    )

    component:SetState(
        state,
        false
    )

    return self:_Add(
        component,
        name
    )
end

function Section:CreateSlider(config)
    config = config or {}

    local name = tostring(
        config.Name or "Slider"
    )

    local min = tonumber(config.Min) or 0
    local max = tonumber(config.Max) or 100
    local step = tonumber(config.Step) or 1

    if max < min then
        min, max = max, min
    end

    if step <= 0 then
        step = 1
    end

    local default = tonumber(config.Default)

    if default == nil then
        default = min
    end

    default = math.clamp(
        default,
        min,
        max
    )

    local frame = self:_CreateBase(50)

    local title = Create("TextLabel", {
        Size = UDim2.new(
            0.7,
            0,
            0,
            18
        ),

        Position = UDim2.new(
            0,
            11,
            0,
            5
        ),

        BackgroundTransparency = 1,

        Text = name,

        TextColor3 =
            self.Window.Theme.TextPrimary,

        TextSize = 12,
        Font = self.Window.Theme.Font,

        TextXAlignment =
            Enum.TextXAlignment.Left,

        Parent = frame,
    })

    local valueLabel = Create("TextLabel", {
        Size = UDim2.new(
            0.25,
            0,
            0,
            18
        ),

        Position = UDim2.new(
            0.73,
            0,
            0,
            5
        ),

        BackgroundTransparency = 1,

        Text = FormatNumber(default),

        TextColor3 =
            self.Window.Theme.TextSecondary,

        TextSize = 11,
        Font = self.Window.Theme.Font,

        TextXAlignment =
            Enum.TextXAlignment.Right,

        Parent = frame,
    })

    local track = Create("Frame", {
        Size = UDim2.new(
            1,
            -22,
            0,
            7
        ),

        Position = UDim2.new(
            0,
            11,
            1,
            -14
        ),

        BackgroundColor3 =
            self.Window.Theme.Track,

        BorderSizePixel = 0,

        Active = true,

        Parent = frame,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(1, 0),
        }),
    })

    local fill = Create("Frame", {
        Size = UDim2.new(
            0,
            0,
            1,
            0
        ),

        BackgroundColor3 =
            self.Window.Theme.Accent,

        BorderSizePixel = 0,

        Parent = track,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(1, 0),
        }),
    })

    local knob = Create("Frame", {
        Size = UDim2.new(0, 14, 0, 14),

        Position = UDim2.new(
            0,
            -7,
            0.5,
            -7
        ),

        BackgroundColor3 =
            self.Window.Theme.Accent,

        BorderSizePixel = 0,

        Parent = track,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(1, 0),
        }),
    })

    local hitArea = Create("TextButton", {
        Size = UDim2.new(1, 12, 0, 28),

        Position = UDim2.new(
            0,
            -6,
            0.5,
            -14
        ),

        BackgroundTransparency = 1,

        Text = "",

        AutoButtonColor = false,

        Active = true,

        Parent = track,
    })

    local component = Component.new(
        self.Window,
        frame
    )

    local value = default
    local dragging = false

    local function ratioOf(number)
        local range = max - min

        if range <= 0 then
            return 0
        end

        return math.clamp(
            (number - min) / range,
            0,
            1
        )
    end

    local function snap(number)
        local snapped =
            min
            + math.round(
                (number - min) / step
            ) * step

        return math.clamp(
            snapped,
            min,
            max
        )
    end

    function component:SetValue(
        newValue,
        fireCallback
    )
        newValue =
            tonumber(newValue)

        if not newValue then
            return self
        end

        value =
            snap(newValue)

        local ratio =
            ratioOf(value)

        fill.Size =
            UDim2.new(
                ratio,
                0,
                1,
                0
            )

        knob.Position =
            UDim2.new(
                ratio,
                -7,
                0.5,
                -7
            )

        valueLabel.Text =
            FormatNumber(value)

        if fireCallback ~= false then
            SafeCallback(
                config.Callback,
                value
            )
        end

        return self
    end

    function component:GetValue()
        return value
    end

    component.ThemeRefresh = function()
        title.TextColor3 =
            self.Window.Theme.TextPrimary

        valueLabel.TextColor3 =
            self.Window.Theme.TextSecondary

        track.BackgroundColor3 =
            self.Window.Theme.Track

        fill.BackgroundColor3 =
            self.Window.Theme.Accent

        knob.BackgroundColor3 =
            self.Window.Theme.Accent
    end

    local function updateFromInput(input)
        local width =
            track.AbsoluteSize.X

        if width <= 0 then
            return
        end

        local ratio =
            (
                input.Position.X
                - track.AbsolutePosition.X
            ) / width

        ratio =
            math.clamp(
                ratio,
                0,
                1
            )

        local newValue =
            min
            + (max - min)
            * ratio

        component:SetValue(
            newValue,
            true
        )
    end

    component:_Connect(
        hitArea.InputBegan,
        function(input, processed)
            if processed then
                return
            end

            if IsActivateInput(input) then
                dragging = true

                updateFromInput(input)
            end
        end
    )

    component:_Connect(
        UserInputService.InputChanged,
        function(input)
            if dragging
                and IsPointerMovement(input) then

                updateFromInput(input)
            end
        end
    )

    component:_Connect(
        UserInputService.InputEnded,
        function(input)
            if IsActivateInput(input) then
                dragging = false
            end
        end
    )

    component:SetValue(
        default,
        false
    )

    return self:_Add(
        component,
        name
    )
end

function Section:CreateDropdown(config)
    config = config or {}

    local name = tostring(
        config.Name or "Dropdown"
    )

    local options =
        type(config.Options) == "table"
        and config.Options
        or {}

    local selected =
        config.Default

    if selected == nil and #options > 0 then
        selected = options[1]
    end

    local opened = false
    local headerHeight = 36
    local itemHeight = 30

    local frame = Create("Frame", {
        Name = name,

        Size = UDim2.new(
            1,
            0,
            0,
            headerHeight
        ),

        BackgroundColor3 =
            self.Window.Theme.ElementBG,

        BorderSizePixel = 0,

        ClipsDescendants = true,

        Parent = self.Frame,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(0, 4),
        }),
    })

    local header = Create("TextButton", {
        Size = UDim2.new(
            1,
            0,
            0,
            headerHeight
        ),

        BackgroundTransparency = 1,

        Text = "",

        AutoButtonColor = false,

        Parent = frame,
    })

    local title = Create("TextLabel", {
        Size = UDim2.new(
            0.45,
            0,
            1,
            0
        ),

        Position = UDim2.new(
            0,
            11,
            0,
            0
        ),

        BackgroundTransparency = 1,

        Text = name,

        TextColor3 =
            self.Window.Theme.TextPrimary,

        TextSize = 12,

        Font = self.Window.Theme.Font,

        TextXAlignment =
            Enum.TextXAlignment.Left,

        Parent = header,
    })

    local selectedLabel = Create("TextLabel", {
        Size = UDim2.new(
            0.40,
            -28,
            1,
            0
        ),

        Position = UDim2.new(
            0.50,
            0,
            0,
            0
        ),

        BackgroundTransparency = 1,

        Text =
            tostring(
                selected or "Select..."
            ),

        TextColor3 =
            self.Window.Theme.TextSecondary,

        TextSize = 11,

        Font = self.Window.Theme.Font,

        TextXAlignment =
            Enum.TextXAlignment.Right,

        Parent = header,
    })

    local arrow = Create("TextLabel", {
        Size = UDim2.new(
            0,
            18,
            1,
            0
        ),

        Position = UDim2.new(
            1,
            -24,
            0,
            0
        ),

        BackgroundTransparency = 1,

        Text = "▼",

        TextColor3 =
            self.Window.Theme.TextSecondary,

        TextSize = 9,

        Font = self.Window.Theme.Font,

        Parent = header,
    })

    local list = Create("Frame", {
        Size = UDim2.new(
            1,
            0,
            0,
            0
        ),

        Position = UDim2.new(
            0,
            0,
            0,
            headerHeight
        ),

        BackgroundColor3 =
            self.Window.Theme.Topbar,

        BorderSizePixel = 0,

        Parent = frame,
    }, {
        Create("UIPadding", {
            PaddingTop = UDim.new(0, 5),
            PaddingBottom = UDim.new(0, 5),
            PaddingLeft = UDim.new(0, 5),
            PaddingRight = UDim.new(0, 5),
        }),

        Create("UIListLayout", {
            Padding = UDim.new(0, 3),
            SortOrder = Enum.SortOrder.LayoutOrder,
        }),
    })

    local component = Component.new(
        self.Window,
        frame
    )

    local items = {}
    local listHeight =
        (#options * itemHeight)
        + (math.max(0, #options - 1) * 3)
        + 10

    local function refreshItems()
        for _, item in ipairs(items) do
            local selectedItem = item.Option == selected

            item.Button.BackgroundColor3 =
                selectedItem
                and self.Window.Theme.Accent
                or self.Window.Theme.ElementBG

            item.Button.TextColor3 =
                selectedItem
                and self.Window.Theme.Background
                or self.Window.Theme.TextPrimary
        end
    end

    for index, option in ipairs(options) do
        local optionButton = Create("TextButton", {
            Name = "Option_" .. index,

            Size = UDim2.new(
                1,
                0,
                0,
                itemHeight
            ),

            BackgroundColor3 =
                self.Window.Theme.ElementBG,

            BorderSizePixel = 0,

            Text = tostring(option),

            TextColor3 =
                self.Window.Theme.TextPrimary,

            TextSize = 11,

            Font = self.Window.Theme.Font,

            AutoButtonColor = false,

            LayoutOrder = index,

            Parent = list,
        }, {
            Create("UICorner", {
                CornerRadius = UDim.new(0, 3),
            }),
        })

        local item = {
            Button = optionButton,
            Option = option,
        }

        table.insert(items, item)

        component:_Connect(
            optionButton.MouseEnter,
            function()
                if option == selected then
                    return
                end

                self.Window:_Tween(
                    optionButton,
                    nil,
                    {
                        BackgroundColor3 =
                            self.Window.Theme.ElementHover,
                    }
                )
            end
        )

        component:_Connect(
            optionButton.MouseLeave,
            function()
                if option == selected then
                    return
                end

                self.Window:_Tween(
                    optionButton,
                    nil,
                    {
                        BackgroundColor3 =
                            self.Window.Theme.ElementBG,
                    }
                )
            end
        )

        component:_Connect(
            optionButton.MouseButton1Click,
            function()
                selected = option

                selectedLabel.Text =
                    tostring(option)

                refreshItems()

                SafeCallback(
                    config.Callback,
                    option
                )

                component:Close()
            end
        )
    end

    function component:Open()
        if opened then
            return self
        end

        self.Window:_CloseAllPopups(
            self
        )

        opened = true

        self.Window:_Tween(
            list,
            nil,
            {
                Size = UDim2.new(
                    1,
                    0,
                    0,
                    listHeight
                ),
            },
            "DropdownList_" .. tostring(frame)
        )

        self.Window:_Tween(
            frame,
            nil,
            {
                Size = UDim2.new(
                    1,
                    0,
                    0,
                    headerHeight + listHeight
                ),
            },
            "DropdownFrame_" .. tostring(frame)
        )

        self.Window:_Tween(
            arrow,
            nil,
            {
                Rotation = 180,
            },
            "DropdownArrow_" .. tostring(frame)
        )

        return self
    end

    function component:Close()
        if not opened then
            return self
        end

        opened = false

        self.Window:_Tween(
            list,
            nil,
            {
                Size = UDim2.new(
                    1,
                    0,
                    0,
                    0
                ),
            },
            "DropdownList_" .. tostring(frame)
        )

        self.Window:_Tween(
            frame,
            nil,
            {
                Size = UDim2.new(
                    1,
                    0,
                    0,
                    headerHeight
                ),
            },
            "DropdownFrame_" .. tostring(frame)
        )

        self.Window:_Tween(
            arrow,
            nil,
            {
                Rotation = 0,
            },
            "DropdownArrow_" .. tostring(frame)
        )

        return self
    end

    function component:ToggleOpen()
        if opened then
            return self:Close()
        end

        return self:Open()
    end

    function component:IsOpen()
        return opened
    end

    function component:SetValue(
        value,
        fireCallback
    )
        for _, option in ipairs(options) do
            if option == value then
                selected = value
                selectedLabel.Text =
                    tostring(value)

                refreshItems()

                if fireCallback ~= false then
                    SafeCallback(
                        config.Callback,
                        value
                    )
                end

                return true
            end
        end

        return false
    end

    function component:GetSelected()
        return selected
    end

    component.ThemeRefresh = function()
        frame.BackgroundColor3 =
            self.Window.Theme.ElementBG

        title.TextColor3 =
            self.Window.Theme.TextPrimary

        selectedLabel.TextColor3 =
            self.Window.Theme.TextSecondary

        arrow.TextColor3 =
            self.Window.Theme.TextSecondary

        list.BackgroundColor3 =
            self.Window.Theme.Topbar

        refreshItems()
    end

    component:_Connect(
        header.MouseButton1Click,
        function()
            component:ToggleOpen()
        end
    )

    component:_Connect(
        header.MouseEnter,
        function()
            self.Window:_Tween(
                frame,
                nil,
                {
                    BackgroundColor3 =
                        self.Window.Theme.ElementHover,
                }
            )
        end
    )

    component:_Connect(
        header.MouseLeave,
        function()
            self.Window:_Tween(
                frame,
                nil,
                {
                    BackgroundColor3 =
                        self.Window.Theme.ElementBG,
                }
            )
        end
    )

    refreshItems()

    self.Window:_RegisterPopup(component)

    return self:_Add(
        component,
        name
    )
end

-- ============================================================
-- Textbox
-- ============================================================

function Section:CreateTextbox(config)
    config = config or {}

    local name = tostring(
        config.Name or "Textbox"
    )

    local frame = self:_CreateBase(
        tonumber(config.Height) or 42
    )

    local label = Create("TextLabel", {
        Size = UDim2.new(
            0.38,
            0,
            1,
            0
        ),

        Position = UDim2.new(
            0,
            11,
            0,
            0
        ),

        BackgroundTransparency = 1,

        Text = name,

        TextColor3 =
            self.Window.Theme.TextPrimary,

        TextSize = 12,

        Font = self.Window.Theme.Font,

        TextXAlignment =
            Enum.TextXAlignment.Left,

        Parent = frame,
    })

    local textbox = Create("TextBox", {
        Size = UDim2.new(
            0.57,
            0,
            0,
            30
        ),

        Position = UDim2.new(
            0.42,
            0,
            0.5,
            -15
        ),

        BackgroundColor3 =
            self.Window.Theme.Track,

        BorderSizePixel = 0,

        ClearTextOnFocus =
            config.ClearOnFocus == true,

        PlaceholderText =
            tostring(
                config.Placeholder or "Enter text..."
            ),

        PlaceholderColor3 =
            self.Window.Theme.TextSecondary,

        Text =
            tostring(
                config.Default or ""
            ),

        TextColor3 =
            self.Window.Theme.TextPrimary,

        TextSize = 11,

        Font = self.Window.Theme.Font,

        TextXAlignment =
            Enum.TextXAlignment.Left,

        Parent = frame,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(0, 4),
        }),

        Create("UIPadding", {
            PaddingLeft = UDim.new(0, 8),
            PaddingRight = UDim.new(0, 8),
        }),
    })

    local component =
        Component.new(
            self.Window,
            frame
        )

    component.TextBox = textbox

    component.ThemeRefresh = function()
        label.TextColor3 =
            self.Window.Theme.TextPrimary

        textbox.BackgroundColor3 =
            self.Window.Theme.Track

        textbox.TextColor3 =
            self.Window.Theme.TextPrimary

        textbox.PlaceholderColor3 =
            self.Window.Theme.TextSecondary
    end

    component:_Connect(
        textbox.FocusLost,
        function(enterPressed)
            SafeCallback(
                config.Callback,
                textbox.Text,
                enterPressed
            )
        end
    )

    function component:SetText(text)
        textbox.Text =
            tostring(
                text or ""
            )

        return self
    end

    function component:GetText()
        return textbox.Text
    end

    function component:SetPlaceholder(text)
        textbox.PlaceholderText =
            tostring(
                text or ""
            )

        return self
    end

    return self:_Add(
        component,
        name
    )
end

-- ============================================================
-- Keybind
-- ============================================================

function Section:CreateKeybind(config)
    config = config or {}

    local name = tostring(
        config.Name or "Keybind"
    )

    local currentKey =
        config.Default
        or Enum.KeyCode.Unknown

    local listening = false

    local frame = self:_CreateBase(38)

    local label = Create("TextLabel", {
        Size = UDim2.new(
            0.55,
            0,
            1,
            0
        ),

        Position = UDim2.new(
            0,
            11,
            0,
            0
        ),

        BackgroundTransparency = 1,

        Text = name,

        TextColor3 =
            self.Window.Theme.TextPrimary,

        TextSize = 12,

        Font = self.Window.Theme.Font,

        TextXAlignment =
            Enum.TextXAlignment.Left,

        Parent = frame,
    })

    local keyButton = Create("TextButton", {
        Size = UDim2.new(
            0,
            112,
            0,
            28
        ),

        Position = UDim2.new(
            1,
            -123,
            0.5,
            -14
        ),

        BackgroundColor3 =
            self.Window.Theme.Track,

        BorderSizePixel = 0,

        Text =
            tostring(
                currentKey.Name
            ),

        TextColor3 =
            self.Window.Theme.TextPrimary,

        TextSize = 10,

        Font = self.Window.Theme.Font,

        AutoButtonColor = false,

        Parent = frame,
    }, {
        Create("UICorner", {
            CornerRadius = UDim.new(0, 4),
        }),
    })

    local component =
        Component.new(
            self.Window,
            frame
        )

    component.ThemeRefresh = function()
        label.TextColor3 =
            self.Window.Theme.TextPrimary

        keyButton.BackgroundColor3 =
            self.Window.Theme.Track

        keyButton.TextColor3 =
            self.Window.Theme.TextPrimary
    end

    function component:SetKey(key)
        if typeof(key) ~= "EnumItem" then
            return self
        end

        currentKey = key
        keyButton.Text = tostring(key.Name)

        SafeCallback(
            config.ChangedCallback,
            key
        )

        return self
    end

    function component:GetKey()
        return currentKey
    end

    function component:BeginListening()
        listening = true

        keyButton.Text = "PRESS KEY"

        self.Window:_Tween(
            keyButton,
            nil,
            {
                BackgroundColor3 =
                    self.Window.Theme.ElementHover,
            }
        )

        return self
    end

    component:_Connect(
        keyButton.MouseButton1Click,
        function()
            component:BeginListening()
        end
    )

    component:_Connect(
        UserInputService.InputBegan,
        function(input)
            if not listening then
                return
            end

            if input.UserInputType ==
                Enum.UserInputType.Keyboard then

                listening = false

                if input.KeyCode ==
                    Enum.KeyCode.Escape then

                    component:SetKey(
                        Enum.KeyCode.Unknown
                    )
                else
                    component:SetKey(
                        input.KeyCode
                    )
                end

                self.Window:_Tween(
                    keyButton,
                    nil,
                    {
                        BackgroundColor3 =
                            self.Window.Theme.Track,
                    }
                )

            elseif input.UserInputType ==
                    Enum.UserInputType.MouseButton1
                or input.UserInputType ==
                    Enum.UserInputType.MouseButton2
                or input.UserInputType ==
                    Enum.UserInputType.MouseButton3 then

                listening = false

                keyButton.Text =
                    tostring(
                        input.UserInputType.Name
                    )

                currentKey =
                    input.UserInputType

                SafeCallback(
                    config.ChangedCallback,
                    currentKey
                )

                self.Window:_Tween(
                    keyButton,
                    nil,
                    {
                        BackgroundColor3 =
                            self.Window.Theme.Track,
                    }
                )
            end
        end
    )

    component:_Connect(
        UserInputService.InputBegan,
        function(input, processed)
            if processed or listening then
                return
            end

            local matched = false

            if input.UserInputType ==
                Enum.UserInputType.Keyboard then

                matched =
                    input.KeyCode
                    == currentKey

            else
                matched =
                    input.UserInputType
                    == currentKey
            end

            if matched then
                SafeCallback(
                    config.Callback
                )
            end
        end
    )

    return self:_Add(
        component,
        name
    )
end

-- ============================================================
-- Color Picker
-- ============================================================

function Section:CreateColorPicker(config)
    config = config or {}

    local name = tostring(
        config.Name or "Color"
    )

    local color =
        ClampColor(
            config.Default
            or Color3.new(1, 1, 1)
        )

    local opened = false

    local frame =
        self:_CreateBase(
            38
        )

    local label =
        Create("TextLabel", {

            Size = UDim2.new(
                0.60,
                0,
                1,
                0
            ),

            Position = UDim2.new(
                0,
                11,
                0,
                0
            ),

            BackgroundTransparency = 1,

            Text = name,

            TextColor3 =
                self.Window.Theme.TextPrimary,

            TextSize = 12,

            Font =
                self.Window.Theme.Font,

            TextXAlignment =
                Enum.TextXAlignment.Left,

            Parent = frame,
        })

    local swatch =
        Create("TextButton", {

            Size = UDim2.new(
                0,
                58,
                0,
                26
            ),

            Position = UDim2.new(
                1,
                -69,
                0.5,
                -13
            ),

            BackgroundColor3 = color,

            BorderSizePixel = 0,

            Text = "",

            AutoButtonColor = false,

            Parent = frame,

        }, {

            Create("UICorner", {
                CornerRadius =
                    UDim.new(
                        0,
                        4
                    ),
            }),

            Create("UIStroke", {
                Color =
                    self.Window.Theme.Stroke,

                Thickness = 1,
            }),
        })

    local picker =
        Create("Frame", {

            Size = UDim2.new(
                1,
                0,
                0,
                0
            ),

            Position = UDim2.new(
                0,
                0,
                1,
                3
            ),

            BackgroundColor3 =
                self.Window.Theme.Topbar,

            BorderSizePixel = 0,

            ClipsDescendants =
                true,

            Parent = frame,

        }, {

            Create("UICorner", {
                CornerRadius =
                    UDim.new(
                        0,
                        4
                    ),
            }),
        })

    local function makeRGBBox(position)
        return Create("TextBox", {

            Size = UDim2.new(
                0.27,
                -4,
                0,
                28
            ),

            Position = position,

            BackgroundColor3 =
                self.Window.Theme.Track,

            BorderSizePixel = 0,

            TextColor3 =
                self.Window.Theme.TextPrimary,

            TextSize = 11,

            Font =
                self.Window.Theme.Font,

            ClearTextOnFocus =
                false,

            TextXAlignment =
                Enum.TextXAlignment.Center,

            Parent = picker,

        }, {

            Create("UICorner", {
                CornerRadius =
                    UDim.new(
                        0,
                        4
                    ),
            }),
        })
    end

    local rBox =
        makeRGBBox(
            UDim2.new(
                0,
                6,
                0,
                7
            )
        )

    local gBox =
        makeRGBBox(
            UDim2.new(
                0.33,
                0,
                0,
                7
            )
        )

    local bBox =
        makeRGBBox(
            UDim2.new(
                0.66,
                -6,
                0,
                7
            )
        )

    local apply =
        Create("TextButton", {

            Size = UDim2.new(
                1,
                -12,
                0,
                28
            ),

            Position = UDim2.new(
                0,
                6,
                0,
                42
            ),

            BackgroundColor3 =
                self.Window.Theme.ElementBG,

            BorderSizePixel = 0,

            Text = "APPLY",

            TextColor3 =
                self.Window.Theme.TextPrimary,

            TextSize = 11,

            Font =
                self.Window.Theme.Font,

            AutoButtonColor = false,

            Parent = picker,

        }, {

            Create("UICorner", {
                CornerRadius =
                    UDim.new(
                        0,
                        4
                    ),
            }),
        })

    local component =
        Component.new(
            self.Window,
            frame
        )

    local function setBoxes()
        local r, g, b =
            ColorBytes(
                color
            )

        rBox.Text = tostring(r)
        gBox.Text = tostring(g)
        bBox.Text = tostring(b)
    end

    local function getByte(box)
        local value =
            tonumber(box.Text)
            or 0

        return math.clamp(
            math.round(value),
            0,
            255
        )
    end

    component.ThemeRefresh = function()
        label.TextColor3 =
            self.Window.Theme.TextPrimary

        picker.BackgroundColor3 =
            self.Window.Theme.Topbar

        rBox.BackgroundColor3 =
            self.Window.Theme.Track

        gBox.BackgroundColor3 =
            self.Window.Theme.Track

        bBox.BackgroundColor3 =
            self.Window.Theme.Track

        rBox.TextColor3 =
            self.Window.Theme.TextPrimary

        gBox.TextColor3 =
            self.Window.Theme.TextPrimary

        bBox.TextColor3 =
            self.Window.Theme.TextPrimary

        apply.BackgroundColor3 =
            self.Window.Theme.ElementBG

        apply.TextColor3 =
            self.Window.Theme.TextPrimary

        swatch.BackgroundColor3 =
            color

        local stroke =
            swatch:FindFirstChildOfClass(
                "UIStroke"
            )

        if stroke then
            stroke.Color =
                self.Window.Theme.Stroke
        end
    end

    function component:SetColor(
        newColor,
        fireCallback
    )
        if typeof(newColor) ~= "Color3" then
            return self
        end

        color =
            ClampColor(
                newColor
            )

        swatch.BackgroundColor3 =
            color

        setBoxes()

        if fireCallback ~= false then
            SafeCallback(
                config.Callback,
                color
            )
        end

        return self
    end

    function component:GetColor()
        return color
    end

    function component:Open()
        if opened then
            return self
        end

        self.Window:_CloseAllPopups(
            self
        )

        opened = true

        self.Window:_Tween(
            picker,
            nil,
            {
                Size = UDim2.new(
                    1,
                    0,
                    0,
                    77
                ),
            },
            "ColorPickerList_" .. tostring(frame)
        )

        self.Window:_Tween(
            frame,
            nil,
            {
                Size = UDim2.new(
                    1,
                    0,
                    0,
                    118
                ),
            },
            "ColorPickerFrame_" .. tostring(frame)
        )

        return self
    end

    function component:Close()
        if not opened then
            return self
        end

        opened = false

        self.Window:_Tween(
            picker,
            nil,
            {
                Size = UDim2.new(
                    1,
                    0,
                    0,
                    0
                ),
            },
            "ColorPickerList_" .. tostring(frame)
        )

        self.Window:_Tween(
            frame,
            nil,
            {
                Size = UDim2.new(
                    1,
                    0,
                    0,
                    38
                ),
            },
            "ColorPickerFrame_" .. tostring(frame)
        )

        return self
    end

    function component:IsOpen()
        return opened
    end

    component:_Connect(
        swatch.MouseButton1Click,
        function()
            if opened then
                component:Close()
            else
                component:Open()
            end
        end
    )

    component:_Connect(
        apply.MouseButton1Click,
        function()
            local newColor =
                Color3.fromRGB(
                    getByte(rBox),
                    getByte(gBox),
                    getByte(bBox)
                )

            component:SetColor(
                newColor,
                true
            )

            component:Close()
        end
    )

    component:SetColor(
        color,
        false
    )

    self.Window:_RegisterPopup(
        component
    )

    return self:_Add(
        component,
        name
    )
end

-- Legacy aliases.
function Section:AddLabel(config)
    return self:CreateLabel(config)
end

function Section:AddButton(config)
    return self:CreateButton(config)
end

function Section:AddToggle(config)
    return self:CreateToggle(config)
end

function Section:AddSlider(config)
    return self:CreateSlider(config)
end

function Section:AddDropdown(config)
    return self:CreateDropdown(config)
end

function Section:AddTextbox(config)
    return self:CreateTextbox(config)
end

function Section:AddKeybind(config)
    return self:CreateKeybind(config)
end

function Section:AddColorPicker(config)
    return self:CreateColorPicker(config)
end

-- ============================================================
-- Tab
-- ============================================================

local Tab = {}
Tab.__index = Tab

function Tab:Select()
    if self.Destroyed then
        return self
    end

    for _, tab in ipairs(self.Window.Tabs) do
        local active = tab == self

        tab.Selected = active
        tab.Content.Visible = active

        local theme = self.Window.Theme

        tab.Button.BackgroundColor3 =
            active
            and theme.Accent
            or theme.ElementBG

        tab.IconLabel.TextColor3 =
            active
            and theme.Background
            or theme.TextSecondary

        tab.TextLabel.TextColor3 =
            active
            and theme.Background
            or theme.TextSecondary

        self.Window:_Tween(
            tab.Indicator,
            nil,
            {
                BackgroundTransparency =
                    active and 0 or 1,
            },
            "TabIndicator_" .. tab.Name
        )
    end

    self.Window.ContentArea.CanvasPosition =
        Vector2.new(0, 0)

    return self
end

function Tab:SetCollapsed(collapsed)
    if collapsed then
        self.TextLabel.Visible = false

        self.IconLabel.Size =
            UDim2.new(
                1,
                0,
                1,
                0
            )

        self.IconLabel.Position =
            UDim2.new(
                0,
                0,
                0,
                0
            )
    else
        self.TextLabel.Visible = true

        self.IconLabel.Size =
            UDim2.new(
                0,
                28,
                1,
                0
            )

        self.IconLabel.Position =
            UDim2.new(
                0,
                8,
                0,
                0
            )
    end

    return self
end

function Tab:RefreshTheme()
    if self.Destroyed then
        return
    end

    local theme =
        self.Window.Theme

    self.Button.BackgroundColor3 =
        self.Selected
        and theme.Accent
        or theme.ElementBG

    local textColor =
        self.Selected
        and theme.Background
        or theme.TextSecondary

    self.IconLabel.TextColor3 =
        textColor

    self.TextLabel.TextColor3 =
        textColor

    self.Indicator.BackgroundColor3 =
        theme.Accent

    for _, section in ipairs(self.Sections) do
        if section.RefreshTheme then
            section:RefreshTheme()
        end
    end
end

function Tab:CreateSection(title)
    title =
        tostring(
            title or "SECTION"
        )

    local section =
        setmetatable({

            Window = self.Window,
            Tab = self,

            Name = title,

            Components = {},

            Destroyed = false,

        }, Section)

    local frame =
        Create("Frame", {

            Name =
                title .. "_Section",

            Size = UDim2.new(
                1,
                0,
                0,
                0
            ),

            AutomaticSize =
                Enum.AutomaticSize.Y,

            BackgroundColor3 =
                self.Window.Theme.Background,

            BorderSizePixel = 0,

            Parent =
                self.Content,

        }, {

            Create("UICorner", {
                CornerRadius =
                    self.Window.Theme.CornerRadius,
            }),

            Create("UIStroke", {
                Color =
                    self.Window.Theme.Stroke,

                Thickness = 1,
            }),

            Create("UIPadding", {
                PaddingTop =
                    UDim.new(0, 11),

                PaddingBottom =
                    UDim.new(0, 11),

                PaddingLeft =
                    UDim.new(0, 11),

                PaddingRight =
                    UDim.new(0, 11),
            }),

            Create("UIListLayout", {
                SortOrder =
                    Enum.SortOrder.LayoutOrder,

                Padding =
                    UDim.new(0, 7),
            }),
        })

    section.Frame =
        frame

    section.Object =
        frame

    local header =
        Create("TextLabel", {

            Name =
                "Header",

            Size = UDim2.new(
                1,
                0,
                0,
                18
            ),

            BackgroundTransparency =
                1,

            Text =
                title:upper(),

            TextColor3 =
                self.Window.Theme.TextSecondary,

            TextSize = 11,

            Font =
                self.Window.Theme.TitleFont,

            TextXAlignment =
                Enum.TextXAlignment.Left,

            LayoutOrder = 0,

            Parent =
                frame,
        })

    section.Header =
        header

    function section:RefreshTheme()
        if self.Destroyed then
            return
        end

        local theme =
            self.Window.Theme

        self.Frame.BackgroundColor3 =
            theme.Background

        local stroke =
            self.Frame:FindFirstChildOfClass(
                "UIStroke"
            )

        if stroke then
            stroke.Color =
                theme.Stroke
        end

        self.Header.TextColor3 =
            theme.TextSecondary

        for _, component in ipairs(
            self.Components
        ) do

            if component.ThemeRefresh then
                pcall(
                    component.ThemeRefresh
                )
            end
        end
    end

    function section:Destroy()
        if self.Destroyed then
            return
        end

        self.Destroyed = true

        for _, component in ipairs(
            self.Components
        ) do

            if component.Destroy then
                component:Destroy()
            end
        end

        table.clear(
            self.Components
        )

        if self.Frame then
            pcall(function()
                self.Frame:Destroy()
            end)
        end
    end

    table.insert(
        self.Sections,
        section
    )

    return section
end

-- ============================================================
-- Window
-- ============================================================

local Window = {}
Window.__index = Window

function Window:_Connect(signal, callback)
    if self.Destroyed then
        return
    end

    return self.Connections:Connect(
        signal,
        callback
    )
end

function Window:_Tween(
    object,
    info,
    properties,
    key
)
    if self.Destroyed then
        return
    end

    return self.Animation:Play(
        object,
        info,
        properties,
        key
    )
end

function Window:_RegisterSearchable(
    component,
    title
)
    if not component then
        return
    end

    component.SearchTitle =
        tostring(
            title or ""
        ):lower()

    table.insert(
        self.Searchables,
        component
    )
end

function Window:_RegisterPopup(component)
    if not component then
        return
    end

    table.insert(
        self.Popups,
        component
    )
end

function Window:_CloseAllPopups(except)
    for _, popup in ipairs(
        self.Popups
    ) do

        if popup ~= except
            and popup.Close then

            pcall(function()
                popup:Close()
            end)
        end
    end
end

function Window:Search(query)
    query =
        tostring(
            query or ""
        ):lower()

    for _, component in ipairs(
        self.Searchables
    ) do

        if component.Object
            and component.Object.Parent then

            if query == "" then
                component.Object.Visible = true
            else
                component.Object.Visible =
                    component.SearchTitle
                        :find(
                            query,
                            1,
                            true
                        )
                    ~= nil
            end
        end
    end

    return self
end

function Window:ClearSearch()
    self.SearchBox.Text = ""
    return self:Search("")
end

function Window:SetTheme(theme)
    if typeof(theme) == "string" then
        local preset =
            Library.Themes[theme]

        if not preset then
            return self
        end

        self.Theme =
            DeepCopy(
                preset
            )

    elseif typeof(theme) == "table" then
        self.Theme =
            Merge(
                self.Theme,
                theme
            )
    else
        return self
    end

    self:_RefreshTheme()

    return self
end

function Window:GetTheme()
    return DeepCopy(
        self.Theme
    )
end

function Window:SetAccent(color)
    if typeof(color) ~= "Color3" then
        return self
    end

    self.Theme.Accent =
        color

    self.Theme.AccentDark =
        color:Lerp(
            self.Theme.Background,
            0.25
        )

    self:_RefreshTheme()

    return self
end

function Window:GetAccent()
    return self.Theme.Accent
end

function Window:SetScale(scale)
    scale =
        math.clamp(
            tonumber(scale) or 1,
            0.60,
            1.25
        )

    self.ScaleValue =
        scale

    self.UIScale.Scale =
        scale

    return self
end

function Window:GetScale()
    return self.ScaleValue
end

function Window:SetPosition(position)
    if typeof(position) == "UDim2" then
        self.MainFrame.Position =
            position

        self.Config.Position =
            position
    end

    return self
end

function Window:GetPosition()
    return self.MainFrame.Position
end

function Window:SetSize(size)
    if typeof(size) == "UDim2" then
        self.MainFrame.Size =
            size

        self.Config.Size =
            size
    end

    return self
end

function Window:GetSize()
    return self.MainFrame.Size
end

function Window:SetVisible(state)
    if self.Destroyed then
        return self
    end

    if state then
        return self:Show()
    end

    return self:Hide()
end

function Window:Show()
    if self.Destroyed or self.Visible then
        return self
    end

    self.Visible = true

    self.MinimizedButton.Visible =
        false

    self.MainFrame.Visible =
        true

    local targetSize =
        self.Config.Size

    self.MainFrame.Size =
        UDim2.new(
            0,
            0,
            0,
            0
        )

    self.MainFrame.BackgroundTransparency =
        1

    self:_Tween(
        self.MainFrame,

        TweenInfo.new(
            0.30,
            Enum.EasingStyle.Back,
            Enum.EasingDirection.Out
        ),

        {
            Size = targetSize,
            BackgroundTransparency = 0,
        },

        "WindowShow"
    )

    return self
end

function Window:Hide()
    if self.Destroyed or not self.Visible then
        return self
    end

    self.Visible = false

    local tween =
        self:_Tween(
            self.MainFrame,

            TweenInfo.new(
                0.22,
                Enum.EasingStyle.Quad,
                Enum.EasingDirection.In
            ),

            {
                Size = UDim2.new(
                    0,
                    0,
                    0,
                    0
                ),

                BackgroundTransparency = 1,
            },

            "WindowHide"
        )

    if tween then
        tween.Completed:Connect(function()
            if self.Destroyed or self.Visible then
                return
            end

            self.MainFrame.Visible =
                false

            self.MinimizedButton.Visible =
                true

            self.MinimizedButton.Size =
                UDim2.new(
                    0,
                    0,
                    0,
                    0
                )

            self:_Tween(
                self.MinimizedButton,

                TweenInfo.new(
                    0.24,
                    Enum.EasingStyle.Back,
                    Enum.EasingDirection.Out
                ),

                {
                    Size = UDim2.new(
                        0,
                        44,
                        0,
                        44
                    ),
                },

                "MiniShow"
            )
        end)
    end

    return self
end

function Window:Toggle()
    if self.Visible then
        return self:Hide()
    end

    return self:Show()
end

function Window:Minimize()
    return self:Hide()
end

function Window:Restore()
    return self:Show()
end

function Window:ToggleSidebar()
    if self.SidebarCollapsed then
        return self:ExpandSidebar()
    end

    return self:CollapseSidebar()
end

function Window:CollapseSidebar()
    if self.SidebarCollapsed then
        return self
    end

    self.SidebarCollapsed =
        true

    local width = 56

    self:_Tween(
        self.Sidebar,
        nil,
        {
            Size =
                UDim2.new(
                    0,
                    width,
                    1,
                    -46
                ),
        },
        "Sidebar"
    )

    self:_Tween(
        self.ContentArea,
        nil,
        {
            Position =
                UDim2.new(
                    0,
                    width + 8,
                    0,
                    52
                ),

            Size =
                UDim2.new(
                    1,
                    -(width + 18),
                    1,
                    -60
                ),
        },
        "ContentArea"
    )

    for _, tab in ipairs(
        self.Tabs
    ) do
        tab:SetCollapsed(true)
    end

    return self
end

function Window:ExpandSidebar()
    if not self.SidebarCollapsed then
        return self
    end

    self.SidebarCollapsed =
        false

    local width =
        self.Config.SidebarWidth

    self:_Tween(
        self.Sidebar,
        nil,
        {
            Size =
                UDim2.new(
                    0,
                    width,
                    1,
                    -46
                ),
        },
        "Sidebar"
    )

    self:_Tween(
        self.ContentArea,
        nil,
        {
            Position =
                UDim2.new(
                    0,
                    width + 8,
                    0,
                    52
                ),

            Size =
                UDim2.new(
                    1,
                    -(width + 18),
                    1,
                    -60
                ),
        },
        "ContentArea"
    )

    for _, tab in ipairs(
        self.Tabs
    ) do
        tab:SetCollapsed(false)
    end

    return self
end

function Window:_UpdateResponsive()
    if self.Destroyed then
        return
    end

    local camera =
        Workspace.CurrentCamera

    if not camera then
        return
    end

    local viewport =
        camera.ViewportSize

    local width =
        viewport.X

    local height =
        viewport.Y

    if width <= 420 then

        self.IsMobile =
            true

        self.Config.SidebarWidth =
            98

        self.Sidebar.Size =
            UDim2.new(
                0,
                98,
                1,
                -46
            )

        self.ContentArea.Position =
            UDim2.new(
                0,
                106,
                0,
                52
            )

        self.ContentArea.Size =
            UDim2.new(
                1,
                -116,
                1,
                -60
            )

        self.TitleLabel.TextSize =
            14

        self.SearchFrame.Visible =
            false

        self.CollapseButton.Visible =
            false

    elseif width <= 700 then

        self.IsMobile =
            true

        self.Config.SidebarWidth =
            116

        self.Sidebar.Size =
            UDim2.new(
                0,
                116,
                1,
                -46
            )

        self.ContentArea.Position =
            UDim2.new(
                0,
                124,
                0,
                52
            )

        self.ContentArea.Size =
            UDim2.new(
                1,
                -134,
                1,
                -60
            )

        self.TitleLabel.TextSize =
            16

        self.SearchFrame.Visible =
            true

        self.SearchFrame.Size =
            UDim2.new(
                1,
                -185,
                0,
                30
            )

        self.SearchFrame.Position =
            UDim2.new(
                0,
                170,
                0,
                8
            )

        self.CollapseButton.Visible =
            false

    else

        self.IsMobile =
            false

        self.Config.SidebarWidth =
            154

        self.CollapseButton.Visible =
            true

        if not self.SidebarCollapsed then

            self.Sidebar.Size =
                UDim2.new(
                    0,
                    154,
                    1,
                    -46
                )

            self.ContentArea.Position =
                UDim2.new(
                    0,
                    162,
                    0,
                    52
                )

            self.ContentArea.Size =
                UDim2.new(
                    1,
                    -172,
                    1,
                    -60
                )
        end

        self.TitleLabel.TextSize =
            18

        self.SearchFrame.Visible =
            true

        self.SearchFrame.Size =
            UDim2.new(
                1,
                -220,
                0,
                32
            )

        self.SearchFrame.Position =
            UDim2.new(
                0,
                200,
                0,
                7
            )
    end

    -- Keep the window within a sensible viewport range.
    if self.IsMobile then
        local currentSize =
            self.MainFrame.AbsoluteSize

        local maxWidth =
            math.max(
                280,
                width - 20
            )

        local maxHeight =
            math.max(
                220,
                height - 20
            )

        if currentSize.X > maxWidth
            or currentSize.Y > maxHeight then

            self.MainFrame.Size =
                UDim2.new(
                    0,
                    math.min(
                        currentSize.X,
                        maxWidth
                    ),
                    0,
                    math.min(
                        currentSize.Y,
                        maxHeight
                    )
                )

            self.Config.Size =
                self.MainFrame.Size
        end
    end
end

function Window:_RefreshTheme()
    if self.Destroyed then
        return
    end

    local theme =
        self.Theme

    self.MainFrame.BackgroundColor3 =
        theme.Background

    self.MainStroke.Color =
        theme.Stroke

    self.Topbar.BackgroundColor3 =
        theme.Topbar

    self.Sidebar.BackgroundColor3 =
        theme.Sidebar

    self.TitleLabel.TextColor3 =
        theme.TextPrimary

    self.SearchFrame.BackgroundColor3 =
        theme.ElementBG

    self.SearchIcon.TextColor3 =
        theme.TextSecondary

    self.SearchBox.TextColor3 =
        theme.TextPrimary

    self.SearchBox.PlaceholderColor3 =
        theme.TextSecondary

    self.ContentArea.ScrollBarImageColor3 =
        theme.Accent

    self.MinimizedButton.BackgroundColor3 =
        theme.Background

    self.MinimizedButton.TextColor3 =
        theme.TextPrimary

    local miniStroke =
        self.MinimizedButton:
            FindFirstChildOfClass(
                "UIStroke"
            )

    if miniStroke then
        miniStroke.Color =
            theme.Stroke
    end

    for _, callback in ipairs(
        self.ThemeRefreshers
    ) do

        pcall(callback)
    end

    for _, tab in ipairs(
        self.Tabs
    ) do

        tab:RefreshTheme()
    end

    self:_RefreshNotifications()
end

function Window:_RegisterThemeRefresh(
    callback
)
    if typeof(callback) == "function" then
        table.insert(
            self.ThemeRefreshers,
            callback
        )
    end
end

function Window:_RefreshNotifications()
    for _, item in ipairs(
        self.Notifications
    ) do

        if item.Refresh then
            pcall(
                item.Refresh
            )
        end
    end
end

-- ============================================================
-- Notifications
-- ============================================================

function Window:Notify(config)
    config = config or {}

    local title =
        tostring(
            config.Title or "NOTICE"
        )

    local text =
        tostring(
            config.Text or ""
        )

    local duration =
        math.max(
            tonumber(
                config.Duration
            ) or 3,
            0.5
        )

    local accent =
        typeof(config.Accent) == "Color3"
        and config.Accent
        or self.Theme.Accent

    local notification =
        Create("Frame", {

            Name =
                "Notification",

            Size = UDim2.new(
                0,
                300,
                0,
                78
            ),

            BackgroundColor3 =
                self.Theme.Topbar,

            BorderSizePixel = 0,

            Parent =
                self.NotificationHolder,

        }, {

            Create("UICorner", {
                CornerRadius =
                    self.Theme.CornerRadius,
            }),

            Create("UIStroke", {
                Color =
                    self.Theme.Stroke,

                Thickness = 1,
            }),
        })

    local stripe =
        Create("Frame", {

            Size = UDim2.new(
                0,
                3,
                1,
                -14
            ),

            Position = UDim2.new(
                0,
                7,
                0,
                7
            ),

            BackgroundColor3 =
                accent,

            BorderSizePixel = 0,

            Parent =
                notification,

        }, {

            Create("UICorner", {
                CornerRadius =
                    UDim.new(
                        1,
                        0
                    ),
            }),
        })

    local titleLabel =
        Create("TextLabel", {

            Size = UDim2.new(
                1,
                -40,
                0,
                20
            ),

            Position = UDim2.new(
                0,
                20,
                0,
                8
            ),

            BackgroundTransparency =
                1,

            Text = title,

            TextColor3 =
                self.Theme.TextPrimary,

            TextSize = 13,

            Font =
                self.Theme.TitleFont,

            TextXAlignment =
                Enum.TextXAlignment.Left,

            Parent =
                notification,
        })

    local body =
        Create("TextLabel", {

            Size = UDim2.new(
                1,
                -40,
                0,
                38
            ),

            Position = UDim2.new(
                0,
                20,
                0,
                31
            ),

            BackgroundTransparency =
                1,

            Text = text,

            TextColor3 =
                self.Theme.TextSecondary,

            TextSize = 11,

            Font =
                self.Theme.Font,

            TextWrapped = true,

            TextXAlignment =
                Enum.TextXAlignment.Left,

            TextYAlignment =
                Enum.TextYAlignment.Top,

            Parent =
                notification,
        })

    local data = {
        Object = notification,
    }

    data.Refresh = function()
        if not notification.Parent then
            return
        end

        notification.BackgroundColor3 =
            self.Theme.Topbar

        stripe.BackgroundColor3 =
            accent

        titleLabel.TextColor3 =
            self.Theme.TextPrimary

        body.TextColor3 =
            self.Theme.TextSecondary

        local stroke =
            notification:
                FindFirstChildOfClass(
                    "UIStroke"
                )

        if stroke then
            stroke.Color =
                self.Theme.Stroke
        end
    end

    table.insert(
        self.Notifications,
        data
    )

    local offset =
        (#self.Notifications - 1)
        * 86

    notification.Position =
        UDim2.new(
            1,
            320,
            1,
            -18 - offset
        )

    self:_Tween(
        notification,

        TweenInfo.new(
            0.30,
            Enum.EasingStyle.Quart,
            Enum.EasingDirection.Out
        ),

        {
            Position =
                UDim2.new(
                    1,
                    -18,
                    1,
                    -18 - offset
                ),
        }
    )

    task.delay(
        duration,
        function()
            if self.Destroyed
                or not notification.Parent then
                return
            end

            self:_Tween(
                notification,

                TweenInfo.new(
                    0.20,
                    Enum.EasingStyle.Quart,
                    Enum.EasingDirection.In
                ),

                {
                    Position =
                        UDim2.new(
                            1,
                            320,
                            1,
                            -18 - offset
                        ),
                }
            )

            task.delay(
                0.23,
                function()
                    if notification.Parent then
                        notification:Destroy()
                    end

                    for index, item in ipairs(
                        self.Notifications
                    ) do

                        if item == data then
                            table.remove(
                                self.Notifications,
                                index
                            )
                            break
                        end
                    end
                end
            )
        end
    )

    return notification
end

-- ============================================================
-- Config
-- ============================================================

function Window:GetConfig()
    return {
        Theme = DeepCopy(
            self.Theme
        ),

        Scale =
            self.ScaleValue,

        Position =
            self.MainFrame.Position,

        Size =
            self.MainFrame.Size,

        SidebarCollapsed =
            self.SidebarCollapsed,
    }
end

function Window:ApplyConfig(config)
    if typeof(config) ~= "table" then
        return self
    end

    if config.Theme then
        self:SetTheme(
            config.Theme
        )
    end

    if config.Scale ~= nil then
        self:SetScale(
            config.Scale
        )
    end

    if typeof(
        config.Position
    ) == "UDim2" then

        self:SetPosition(
            config.Position
        )
    end

    if typeof(
        config.Size
    ) == "UDim2" then

        self:SetSize(
            config.Size
        )
    end

    if config.SidebarCollapsed then
        self:CollapseSidebar()
    else
        self:ExpandSidebar()
    end

    return self
end

function Window:GetTab(name)
    name =
        tostring(
            name or ""
        ):lower()

    for _, tab in ipairs(
        self.Tabs
    ) do

        if tab.Name:lower()
            == name then

            return tab
        end
    end
end

function Window:SelectTab(name)
    local tab =
        self:GetTab(name)

    if tab then
        return tab:Select()
    end
end

function Window:SetToggleKey(key)
    if typeof(key) ==
        "EnumItem" then

        self.ToggleKey =
            key
    end

    return self
end

-- ============================================================
-- Window Destroy
-- ============================================================

function Window:Destroy()
    if self.Destroyed then
        return
    end

    self.Destroyed = true

    self.Animation:Destroy()
    self.Connections:Clear()

    for _, tab in ipairs(
        self.Tabs
    ) do

        for _, section in ipairs(
            tab.Sections
        ) do

            if section.Destroy then
                pcall(function()
                    section:Destroy()
                end)
            end
        end
    end

    table.clear(
        self.Tabs
    )

    table.clear(
        self.Searchables
    )

    table.clear(
        self.ThemeRefreshers
    )

    table.clear(
        self.Notifications
    )

    table.clear(
        self.Popups
    )

    if self.ScreenGui then
        pcall(function()
            self.ScreenGui:Destroy()
        end)
    end

    for index, item in ipairs(
        Library.Windows
    ) do

        if item == self then
            table.remove(
                Library.Windows,
                index
            )

            break
        end
    end
end

-- ============================================================
-- Create Window
-- ============================================================

function Library:CreateWindow(config)
    config = config or {}

    -- Clean up an older UI instance belonging to this library.
    for index = #self.Windows, 1, -1 do
        local existing = self.Windows[index]

        if existing and not existing.Destroyed then
            existing:Destroy()
        end
    end

    local window =
        setmetatable(
            {},
            Window
        )

    window.Name =
        tostring(
            config.Name or "SYSTEM"
        )

    window.ToggleKey =
        config.ToggleKey
        or Enum.KeyCode.RightShift

    local themeName =
        typeof(config.Theme) == "string"
        and config.Theme
        or Library.DefaultTheme

    local baseTheme =
        Library.Themes[
            themeName
        ]
        or Library.Themes.Dark

    window.Theme =
        DeepCopy(
            baseTheme
        )

    if typeof(
        config.Theme
    ) == "table" then

        window.Theme =
            Merge(
                window.Theme,
                config.Theme
            )
    end

    window.ScaleValue =
        math.clamp(
            tonumber(
                config.Scale
            ) or 0.80,
            0.60,
            1.25
        )

    window.Config = {
        Size =
            config.Size
            or UDim2.new(
                0,
                760,
                0,
                500
            ),

        Position =
            config.Position
            or UDim2.new(
                0.5,
                0,
                0.5,
                0
            ),

        SidebarWidth = 154,

        Draggable =
            config.Draggable
            ~= false,
    }

    window.Tabs = {}
    window.Searchables = {}
    window.ThemeRefreshers = {}
    window.Notifications = {}
    window.Popups = {}

    window.Connections =
        ConnectionManager.new()

    window.Animation =
        AnimationManager.new()

    window.Destroyed = false
    window.Visible = true
    window.SidebarCollapsed = false

    -- ========================================================
    -- ScreenGui Parent
    -- ========================================================

    local guiParent

    pcall(function()
        guiParent =
            LocalPlayer
            and LocalPlayer:WaitForChild(
                "PlayerGui",
                5
            )
    end)

    if not guiParent then
        error(
            "[MonochromeUI] PlayerGui is unavailable."
        )
    end

    local screenGui =
        Create("ScreenGui", {

            Name =
                "MonochromeUI",

            ResetOnSpawn = false,

            IgnoreGuiInset = true,

            ZIndexBehavior =
                Enum.ZIndexBehavior.Sibling,

            DisplayOrder = 999,

            Parent =
                guiParent,
        })

    window.ScreenGui =
        screenGui

    -- ========================================================
    -- UIScale
    -- ========================================================

    local uiScale =
        Create("UIScale", {

            Scale =
                window.ScaleValue,

            Parent =
                screenGui,
        })

    window.UIScale =
        uiScale

    -- ========================================================
    -- MainFrame
    -- ========================================================

    local mainFrame =
        Create("Frame", {

            Name =
                "MainFrame",

            Size =
                window.Config.Size,

            Position =
                window.Config.Position,

            AnchorPoint =
                Vector2.new(
                    0.5,
                    0.5
                ),

            BackgroundColor3 =
                window.Theme.Background,

            BorderSizePixel = 0,

            Parent =
                screenGui,

        }, {

            Create("UICorner", {
                CornerRadius =
                    window.Theme.CornerRadius,
            }),

            Create("UISizeConstraint", {

                MinSize =
                    Vector2.new(
                        280,
                        220
                    ),

                MaxSize =
                    Vector2.new(
                        1200,
                        850
                    ),
            }),
        })

    window.MainFrame =
        mainFrame

    window.MainStroke =
        Create("UIStroke", {

            Color =
                window.Theme.Stroke,

            Thickness = 1,

            Parent =
                mainFrame,
        })

    -- ========================================================
    -- Topbar
    -- ========================================================

    local topbar =
        Create("Frame", {

            Name =
                "Topbar",

            Size =
                UDim2.new(
                    1,
                    0,
                    0,
                    46
                ),

            BackgroundColor3 =
                window.Theme.Topbar,

            BorderSizePixel = 0,

            Parent =
                mainFrame,

        }, {

            Create("UICorner", {
                CornerRadius =
                    window.Theme.CornerRadius,
            }),
        })

    window.Topbar =
        topbar

    local titleLabel =
        Create("TextLabel", {

            Size =
                UDim2.new(
                    0,
                    180,
                    1,
                    0
                ),

            Position =
                UDim2.new(
                    0,
                    16,
                    0,
                    0
                ),

            BackgroundTransparency =
                1,

            Text =
                window.Name,

            TextColor3 =
                window.Theme.TextPrimary,

            TextSize = 18,

            Font =
                window.Theme.TitleFont,

            TextXAlignment =
                Enum.TextXAlignment.Left,

            Parent =
                topbar,
        })

    window.TitleLabel =
        titleLabel

    local function topButton(
        name,
        text,
        offset
    )
        local button =
            Create("TextButton", {

                Name = name,

                Size = UDim2.new(
                    0,
                    30,
                    0,
                    30
                ),

                Position = UDim2.new(
                    1,
                    offset,
                    0.5,
                    -15
                ),

                BackgroundColor3 =
                    window.Theme.ElementBG,

                BorderSizePixel = 0,

                Text = text,

                TextColor3 =
                    window.Theme.TextSecondary,

                TextSize = 16,

                Font =
                    window.Theme.Font,

                AutoButtonColor =
                    false,

                Parent =
                    topbar,

            }, {

                Create("UICorner", {
                    CornerRadius =
                        UDim.new(
                            0,
                            4
                        ),
                }),
            })

        window:_Connect(
            button.MouseEnter,
            function()

                window:_Tween(
                    button,
                    nil,
                    {
                        BackgroundColor3 =
                            window.Theme.ElementHover,

                        TextColor3 =
                            window.Theme.TextPrimary,
                    },
                    "TopHover_" .. name
                )
            end
        )

        window:_Connect(
            button.MouseLeave,
            function()

                window:_Tween(
                    button,
                    nil,
                    {
                        BackgroundColor3 =
                            window.Theme.ElementBG,

                        TextColor3 =
                            window.Theme.TextSecondary,
                    },
                    "TopHover_" .. name
                )
            end
        )

        window:_RegisterThemeRefresh(
            function()

                if not button.Parent then
                    return
                end

                button.BackgroundColor3 =
                    window.Theme.ElementBG

                button.TextColor3 =
                    window.Theme.TextSecondary
            end
        )

        return button
    end

    window.CollapseButton =
        topButton(
            "SidebarButton",
            "≡",
            -116
        )

    window.TopMinimizeButton =
        topButton(
            "MinimizeButton",
            "−",
            -78
        )

    window.CloseButton =
        topButton(
            "CloseButton",
            "×",
            -40
        )

    -- ========================================================
    -- Sidebar
    -- ========================================================

    local sidebar =
        Create("Frame", {

            Name =
                "Sidebar",

            Size =
                UDim2.new(
                    0,
                    154,
                    1,
                    -46
                ),

            Position =
                UDim2.new(
                    0,
                    0,
                    0,
                    46
                ),

            BackgroundColor3 =
                window.Theme.Sidebar,

            BorderSizePixel = 0,

            Parent =
                mainFrame,
        })

    window.Sidebar =
        sidebar

    Create("UIPadding", {

        PaddingTop =
            UDim.new(
                0,
                10
            ),

        PaddingBottom =
            UDim.new(
                0,
                10
            ),

        PaddingLeft =
            UDim.new(
                0,
                9
            ),

        PaddingRight =
            UDim.new(
                0,
                9
            ),

        Parent =
            sidebar,
    })

    Create("UIListLayout", {

        Padding =
            UDim.new(
                0,
                6
            ),

        SortOrder =
            Enum.SortOrder.LayoutOrder,

        Parent =
            sidebar,
    })

    window.TabContainer =
        sidebar

    -- ========================================================
    -- Search
    -- ========================================================

    local searchFrame =
        Create("Frame", {

            Name =
                "Search",

            Size =
                UDim2.new(
                    1,
                    -220,
                    0,
                    32
                ),

            Position =
                UDim2.new(
                    0,
                    200,
                    0,
                    7
                ),

            BackgroundColor3 =
                window.Theme.ElementBG,

            BorderSizePixel = 0,

            Parent =
                topbar,

        }, {

            Create("UICorner", {
                CornerRadius =
                    UDim.new(
                        0,
                        4
                    ),
            }),
        })

    window.SearchFrame =
        searchFrame

    local searchIcon =
        Create("TextLabel", {

            Size =
                UDim2.new(
                    0,
                    24,
                    1,
                    0
                ),

            Position =
                UDim2.new(
                    0,
                    8,
                    0,
                    0
                ),

            BackgroundTransparency =
                1,

            Text = "⌕",

            TextColor3 =
                window.Theme.TextSecondary,

            TextSize = 15,

            Font =
                window.Theme.Font,

            Parent =
                searchFrame,
        })

    window.SearchIcon =
        searchIcon

    local searchBox =
        Create("TextBox", {

            Size =
                UDim2.new(
                    1,
                    -38,
                    1,
                    0
                ),

            Position =
                UDim2.new(
                    0,
                    32,
                    0,
                    0
                ),

            BackgroundTransparency =
                1,

            ClearTextOnFocus =
                false,

            PlaceholderText =
                "Search...",

            PlaceholderColor3 =
                window.Theme.TextSecondary,

            Text = "",

            TextColor3 =
                window.Theme.TextPrimary,

            TextSize = 11,

            Font =
                window.Theme.Font,

            TextXAlignment =
                Enum.TextXAlignment.Left,

            Parent =
                searchFrame,
        })

    window.SearchBox =
        searchBox

    -- ========================================================
    -- Content
    -- ========================================================

    local contentArea =
        Create("ScrollingFrame", {

            Name =
                "ContentArea",

            Size =
                UDim2.new(
                    1,
                    -172,
                    1,
                    -60
                ),

            Position =
                UDim2.new(
                    0,
                    162,
                    0,
                    52
                ),

            BackgroundTransparency =
                1,

            BorderSizePixel = 0,

            ScrollBarThickness = 3,

            ScrollBarImageTransparency = 0.15,

            ScrollBarImageColor3 =
                window.Theme.Accent,

            CanvasSize =
                UDim2.new(
                    0,
                    0,
                    0,
                    0
                ),

            AutomaticCanvasSize =
                Enum.AutomaticSize.Y,

            ScrollingDirection =
                Enum.ScrollingDirection.Y,

            Active = true,

            Parent =
                mainFrame,

        }, {

            Create("UIPadding", {

                PaddingTop =
                    UDim.new(
                        0,
                        4
                    ),

                PaddingBottom =
                    UDim.new(
                        0,
                        8
                    ),

                PaddingLeft =
                    UDim.new(
                        0,
                        2
                    ),

                PaddingRight =
                    UDim.new(
                        0,
                        6
                    ),
            }),

            Create("UIListLayout", {

                Padding =
                    UDim.new(
                        0,
                        9
                    ),

                SortOrder =
                    Enum.SortOrder.LayoutOrder,
            }),
        })

    window.ContentArea =
        contentArea

    -- ========================================================
    -- Notifications
    -- ========================================================

    local notificationHolder =
        Create("Frame", {

            Name =
                "NotificationHolder",

            Size =
                UDim2.new(
                    0,
                    320,
                    1,
                    0
                ),

            Position =
                UDim2.new(
                    1,
                    0,
                    0,
                    0
                ),

            AnchorPoint =
                Vector2.new(
                    1,
                    0
                ),

            BackgroundTransparency =
                1,

            Parent =
                screenGui,
        })

    window.NotificationHolder =
        notificationHolder

    -- ========================================================
    -- Minimized Button
    -- ========================================================

    local mini =
        Create("TextButton", {

            Name =
                "MinimizedButton",

            Size =
                UDim2.new(
                    0,
                    44,
                    0,
                    44
                ),

            Position =
                UDim2.new(
                    0,
                    18,
                    0.5,
                    -22
                ),

            BackgroundColor3 =
                window.Theme.Background,

            BorderSizePixel = 0,

            Text =
                string.sub(
                    window.Name,
                    1,
                    1
                ),

            TextColor3 =
                window.Theme.TextPrimary,

            TextSize = 18,

            Font =
                window.Theme.TitleFont,

            AutoButtonColor =
                false,

            Visible = false,

            Parent =
                screenGui,

        }, {

            Create("UICorner", {
                CornerRadius =
                    UDim.new(
                        0,
                        6
                    ),
            }),

            Create("UIStroke", {
                Color =
                    window.Theme.Stroke,

                Thickness = 1,
            }),
        })

    window.MinimizedButton =
        mini

    -- ========================================================
    -- Search / Topbar Events
    -- ========================================================

    window:_Connect(
        searchBox:GetPropertyChangedSignal(
            "Text"
        ),
        function()
            window:Search(
                searchBox.Text
            )
        end
    )

    window:_Connect(
        window.CollapseButton.MouseButton1Click,
        function()
            window:ToggleSidebar()
        end
    )

    window:_Connect(
        window.TopMinimizeButton.MouseButton1Click,
        function()
            window:Hide()
        end
    )

    window:_Connect(
        window.CloseButton.MouseButton1Click,
        function()
            window:Hide()
        end
    )

    window:_Connect(
        mini.MouseButton1Click,
        function()
            window:Show()
        end
    )

    -- ========================================================
    -- Dragging
    -- ========================================================

    local dragging = false
    local dragInput
    local dragStart
    local startPosition

    local function beginDrag(input)
        dragging = true
        dragInput = input
        dragStart = input.Position
        startPosition = mainFrame.Position
    end

    if window.Config.Draggable then

        window:_Connect(
            topbar.InputBegan,
            function(
                input,
                processed
            )
                if processed then
                    return
                end

                if IsActivateInput(
                    input
                ) then

                    beginDrag(
                        input
                    )
                end
            end
        )

        window:_Connect(
            topbar.InputEnded,
            function(input)
                if IsActivateInput(input)
                    and input == dragInput then

                    dragging = false
                    dragInput = nil
                end
            end
        )

        window:_Connect(
            UserInputService.InputChanged,
            function(input)

                if not dragging then
                    return
                end

                if not IsPointerMovement(
                    input
                ) then
                    return
                end

                local delta =
                    input.Position
                    - dragStart

                mainFrame.Position =
                    UDim2.new(

                        startPosition.X.Scale,

                        startPosition.X.Offset
                            + delta.X,

                        startPosition.Y.Scale,

                        startPosition.Y.Offset
                            + delta.Y
                    )

                window.Config.Position =
                    mainFrame.Position
            end
        )
    end

    -- ========================================================
    -- Toggle Key
    -- ========================================================

    window:_Connect(
        UserInputService.InputBegan,
        function(
            input,
            processed
        )
            if processed then
                return
            end

            if input.KeyCode ==
                window.ToggleKey then

                window:Toggle()
            end
        end
    )

    -- ========================================================
    -- Viewport Updates
    -- ========================================================

    local function connectCamera()
        local camera =
            Workspace.CurrentCamera

        if not camera then
            return
        end

        window:_Connect(
            camera:GetPropertyChangedSignal(
                "ViewportSize"
            ),
            function()
                window:_UpdateResponsive()
            end
        )
    end

    connectCamera()
    window:_UpdateResponsive()

    -- ========================================================
    -- Initial Theme
    -- ========================================================

    window:_RefreshTheme()

    table.insert(
        Library.Windows,
        window
    )

    if config.AutoNotify then
        task.defer(function()

            if not window.Destroyed then
                window:Notify({
                    Title =
                        window.Name,

                    Text =
                        "UI initialized.",

                    Duration = 2,
                })
            end
        end)
    end

    return window
end

-- ============================================================
-- Global Library API
-- ============================================================

function Library:SetTheme(theme)
    for _, window in ipairs(
        self.Windows
    ) do

        if not window.Destroyed then
            window:SetTheme(
                theme
            )
        end
    end

    return self
end

function Library:SetAccent(color)
    for _, window in ipairs(
        self.Windows
    ) do

        if not window.Destroyed then
            window:SetAccent(
                color
            )
        end
    end

    return self
end

function Library:Notify(config)
    local window =
        self.Windows[
            #self.Windows
        ]

    if window
        and not window.Destroyed then

        return window:Notify(
            config
        )
    end
end

function Library:DestroyAll()
    local copy =
        table.clone(
            self.Windows
        )

    for _, window in ipairs(
        copy
    ) do

        window:Destroy()
    end
end

function Library:GetTheme(name)
    name =
        tostring(
            name or ""
        )

    if self.Themes[name] then
        return DeepCopy(
            self.Themes[name]
        )
    end
end

function Library:AddTheme(
    name,
    theme
)
    name =
        tostring(
            name or ""
        )

    if name == ""
        or typeof(theme) ~= "table" then

        return false
    end

    self.Themes[name] =
        Merge(
            self.Themes.Dark,
            theme
        )

    return true
end

return Library
