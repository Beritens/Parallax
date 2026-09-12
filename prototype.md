# Prototype Scope
- subject overview
- add images
  - taking picture
  - aligning art with reality
- viewing subject
- everything just local for now

# subject overview
- list of subjects
  - each has one representative image (use first for now)
- plus button -> add image
- click on subject -> viewing subject

# Add images

- simple flow
- at each step you can go back and redo the images
- Three steps: artwork → reference (including confirmation/alignment) → details
- On mobile, capture and confirmation fill the entire screen, with no scrolling page, large headings, or slider panel
- Minimal controls on the edges: back/close at the top; library, capture/confirm, and retake at the bottom, clear of system safe areas

## first view
- take picture of artwork
- full-screen camera on mobile
- confirm the image or retake before continuing

## second view
- take picture of reference/reality
- artwork visible as low opacity overlay
  - initially use exactly the same centered, screen-filling crop shown when confirming the artwork photo
  - one-finger drag to move; two-finger twist to rotate; pinch to resize
  - these gestures work both over the live camera and after taking/uploading the reference
  - no sliders on mobile; retain sliders for desktop precision
  - compact reset and show/hide-artwork controls at the edge
- confirm the reference photo and its alignment here, or retake
- original image and alignment coordinates are preserved even when the mobile preview fills/crops to the screen
- live camera and captured confirmation use the same fixed viewport and centered cover crop on both mobile and desktop
- preserve the artwork's visible translation, rotation, and scale when camera/photo dimensions change
- webcam previews and captured photos are both unmirrored, including front-camera fallback on desktop

## third view
- add information
  - subject (used as a key to link different images)
  - description (optional)
- save
  - images, alignment, information plus some metadata (date)


## after saving
- estimate camera positions and subject locations from reference images
  - update camera location estimation

# viewing subject

You have a virtual camera (purely mathematical, no actual 3d engine) you can move around, then artworks gets displayed is a way that matched the virtual camera perspective

- "3d" view
  - typical 3d control. e.g. swiping to rotate around subject
  - zoom to go closer
- always show artwork which camera position is closest to the viewing
  - should take image alignment into account
  - keep subject at same position
    - if one artwork doesn't look directly at subject, image should be translated/rotated so the subject doesn't jump around when rotating
- add button -> Add image (with prefilled subject)

# Concerns
- Mobile first
  - should work on a phone
- you should also be able to upload images (though directly using camera in the app is the default)
- downloadable data
  - the data from this prototype will be very useful for the actual thing so I want to be able to download stuff
    - images, alignment, data (preferably in a nice data structure that can be used later)

# Technology idea:
- react native
- look for framework/libraries that already have needed capabilities
  - expo-camera for example
  - expo-sqlite for data storage etc.
